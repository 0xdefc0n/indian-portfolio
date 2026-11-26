// Queued uploads (plan §10.1 D, §13 item 5): the dialog's queued state, the Processing list on Members, and the
// failed-upload toast on the next visit. Jobs carry no PDF data, names or PANs; only ids and status.
import { CircleAlertIcon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { Button } from "@/components/ui/button"
import { type AddedStatement, api, type Job, jobMessage, SignedOut } from "@/lib/api"

/** "less than a minute" / "about 3 min". */
function etaLabel(s: number | null) {
  if (s == null) return null
  if (s < 60) return "less than a minute"
  return `about ${Math.round(s / 60)} min`
}

function queueLine(job: Pick<Job, "status" | "position" | "eta_s">) {
  if (job.status === "parsing") return "Reading statement…"
  const ahead = Math.max(0, (job.position ?? 1) - 1)
  return ["In queue", etaLabel(job.eta_s), ahead ? `${ahead} ahead of you` : "next in line"].filter(Boolean).join(" · ")
}

/**
 * The dialog's queued state (`202`). Polls GET /api/jobs/:id following the server's Retry-After (§11), and reports
 * the outcome. Closing the dialog stops polling; the job carries on and shows in the Processing list.
 */
export function QueuedUpload({ initial, onDone, onFailed, onCancelled }: {
  initial: { id: string; position: number; eta_s: number }
  onDone: (added: AddedStatement) => void
  onFailed: (message: string) => void
  onCancelled: () => void
}) {
  const [job, setJob] = useState<Pick<Job, "status" | "position" | "eta_s">>({ status: "queued", position: initial.position, eta_s: initial.eta_s })
  const [cancelling, setCancelling] = useState(false)
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(started)
  const handlers = useRef({ onDone, onFailed })
  useEffect(() => {
    handlers.current = { onDone, onFailed }
  })

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    let wait = 2
    const poll = async () => {
      try {
        const { job: j, retryAfter } = await api.job(initial.id)
        if (stop) return
        setJob(j)
        setNow(Date.now())
        if (j.status === "done") {
          if (j.statement && j.member) handlers.current.onDone({ statement: j.statement, member: j.member })
          else handlers.current.onFailed("This statement was added, then removed.")
          return
        }
        if (j.status === "failed" || j.status === "expired") {
          handlers.current.onFailed(jobMessage(j.error_code))
          return
        }
        wait = retryAfter ?? Math.min(10, wait * 1.5)
      } catch (err) {
        if (err instanceof SignedOut || stop) return
        wait = Math.min(10, wait * 2) // a blip: keep trying with backoff
      }
      timer = setTimeout(poll, wait * 1000)
    }
    timer = setTimeout(poll, 2000)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [initial.id])

  async function cancel() {
    setCancelling(true)
    try {
      await api.cancelJob(initial.id)
      toast.success("Upload cancelled", { description: "The statement file was deleted." })
      onCancelled()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
      setCancelling(false)
    }
  }

  // Progress from the ETA: time waited so far against time still to go. Never shows done before it is.
  const waited = (now - started) / 1000
  const left = job.status === "parsing" ? 2 : Math.max(1, job.eta_s ?? initial.eta_s)
  const progress = Math.min(0.95, Math.max(0.04, waited / (waited + left)))

  return (
    <div className="grid gap-4" aria-live="polite">
      <div className="grid gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
          {queueLine(job)}
        </p>
        <span className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Upload progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span className="block h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Your statement passed every check and is waiting its turn. You can close this window; we'll finish it for you.
      </p>
      {job.status === "queued" && (
        <Button type="button" variant="outline" className="h-11" disabled={cancelling} onClick={cancel}>
          {cancelling && <Loader2Icon className="animate-spin" />}
          Cancel upload
        </Button>
      )}
    </div>
  )
}

/** Open jobs (with their ETA) and failed ones (with the safe message), at the top of Members. */
export function ProcessingList({ jobs, onRetry, onChange }: { jobs: Job[]; onRetry: () => void; onChange: () => void }) {
  const shown = jobs.filter((j) => j.status !== "done")
  const [busy, setBusy] = useState<string | null>(null)
  if (!shown.length) return null

  async function remove(job: Job) {
    setBusy(job.id)
    try {
      await api.cancelJob(job.id)
      if (job.status === "queued") toast.success("Upload cancelled", { description: "The statement file was deleted." })
      onChange()
    } catch (err) {
      if (!(err instanceof SignedOut)) toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[22px] bg-surface p-5 ring-1 ring-border sm:p-6" aria-labelledby="processing-title">
      <h2 id="processing-title" className="mb-2 text-[15px] font-semibold tracking-tight">Processing</h2>
      <ul className="divide-y divide-border">
        {shown.map((j) => {
          const open = j.status === "queued" || j.status === "parsing"
          return (
            <li key={j.id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="flex min-w-0 items-center gap-2.5 py-2">
                {open
                  ? <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  : <CircleAlertIcon className="size-4 shrink-0 text-loss" />}
                <span className={open ? "min-w-0" : "min-w-0 text-loss"}>{open ? queueLine(j) : jobMessage(j.error_code)}</span>
              </span>
              <span className="-mr-2 flex shrink-0 items-center">
                {!open && (
                  <Button variant="ghost" className="h-11 min-w-11" aria-label="Try again" onClick={onRetry}>
                    <RotateCcwIcon />
                    <span className="hidden sm:inline">Try again</span>
                  </Button>
                )}
                {j.status !== "parsing" && (
                  <Button variant="ghost" size="icon" className="size-11" disabled={busy === j.id}
                    aria-label={open ? "Cancel this upload" : "Dismiss"} onClick={() => remove(j)}>
                    {busy === j.id ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const SEEN_KEY = "pf.failedJobsSeen"

/**
 * On the next visit after a queued upload failed, say so once, with "Try again" (plan §13 item 5). Remembers which
 * job ids it showed (ids only) in localStorage.
 */
export function FailedJobNotices() {
  const [, navigate] = useLocation()
  useEffect(() => {
    let stop = false
    api.jobs().then(
      (jobs) => {
        if (stop) return
        let seen: string[] = []
        try {
          seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")
        } catch {
          seen = []
        }
        const fresh = jobs.filter((j) => (j.status === "failed" || j.status === "expired") && !seen.includes(j.id))
        for (const j of fresh) {
          toast.error("A statement couldn't be added", {
            description: jobMessage(j.error_code),
            action: { label: "Try again", onClick: () => navigate("/members?add=1") },
            duration: 10_000,
          })
        }
        const keep = jobs.map((j) => j.id).filter((id) => seen.includes(id) || fresh.some((f) => f.id === id))
        localStorage.setItem(SEEN_KEY, JSON.stringify(keep))
      },
      () => undefined,
    )
    return () => {
      stop = true
    }
  }, [navigate])
  return null
}

