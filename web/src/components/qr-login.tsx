// "Log in with QR" on a signed-out device (plan §7.4, §13 item 1): show a QR code of the /link URL plus the code in
// text, poll until a signed-in device approves, then the server sets the session cookie on the poll's answer.
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { encode } from "uqr"

import { Button } from "@/components/ui/button"
import { auth, type QrCode } from "@/lib/api"

/** A code lasts 5 minutes; show a new one by itself a few times, then wait for a tap (each costs one of 10 an hour). */
const AUTO_REFRESHES = 3

type State =
  | { kind: "loading" }
  | { kind: "showing"; code: QrCode; expiresAt: number }
  | { kind: "approved" }
  | { kind: "stopped"; reason: "denied" | "expired" | "error"; message?: string }

/** The QR modules as one SVG path. Dark on light whatever the theme: phone cameras read that reliably. */
export function QrImage({ text, label }: { text: string; label: string }) {
  const path = useMemo(() => {
    const { data, size } = encode(text, { ecc: "M", border: 2 })
    let d = ""
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y]![x]) d += `M${x} ${y}h1v1h-1z`
    return { d, size }
  }, [text])
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="aspect-square w-full max-w-[232px] rounded-xl bg-white"
    >
      <path d={path.d} fill="black" />
    </svg>
  )
}

function useSecondsLeft(until: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return until === null ? 0 : Math.max(0, Math.floor((until - now) / 1000))
}

export function QrLogin({ next }: { next: string }) {
  const [state, setState] = useState<State>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  const autoLeft = useRef(AUTO_REFRESHES)
  const restart = () => {
    setState({ kind: "loading" })
    setAttempt((a) => a + 1)
  }

  // Ask for a code, then poll it. A new `attempt` starts over.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    auth.qrStart().then(
      (code) => {
        if (stop) return
        const expiresAt = Date.now() + code.expires_in * 1000
        setState({ kind: "showing", code, expiresAt })
        let wait = code.interval
        const poll = async () => {
          if (stop) return
          let status
          try {
            status = (await auth.qrPoll(code.device_code)).status
          } catch {
            status = "pending" as const // a dropped connection: keep trying until the code expires
          }
          if (stop) return
          if (status === "approved") {
            setState({ kind: "approved" })
            window.location.assign(next)
            return
          }
          if (status === "denied") return setState({ kind: "stopped", reason: "denied" })
          if (status === "expired" || Date.now() > expiresAt) {
            if (autoLeft.current-- > 0) return restart()
            return setState({ kind: "stopped", reason: "expired" })
          }
          if (status === "slow_down") wait += 5 // RFC 8628 §3.5
          timer = setTimeout(poll, wait * 1000)
        }
        timer = setTimeout(poll, wait * 1000)
      },
      (e: Error) => !stop && setState({ kind: "stopped", reason: "error", message: e.message }),
    )
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [attempt, next])

  const secondsLeft = useSecondsLeft(state.kind === "showing" ? state.expiresAt : null)
  const again = () => {
    autoLeft.current = AUTO_REFRESHES
    restart()
  }

  if (state.kind === "stopped") {
    const text =
      state.reason === "denied" ? "The other device declined this sign-in."
      : state.reason === "expired" ? "That code has expired."
      : state.message
    return (
      <div className="grid justify-items-center gap-4 py-4 text-center">
        <p className="text-sm text-muted-foreground" role="status">{text}</p>
        <Button variant="outline" className="h-11" onClick={again}><RefreshCwIcon /> Show a new code</Button>
      </div>
    )
  }

  return (
    <div className="grid justify-items-center gap-4 text-center">
      <div className="grid aspect-square w-full max-w-[232px] place-items-center">
        {state.kind === "showing" ? (
          <QrImage text={state.code.verification_uri_complete} label="QR code to sign in on this device" />
        ) : (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        )}
      </div>
      {state.kind === "approved" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" /> Signing you in…
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs text-muted-foreground">Code</p>
            <p className="font-mono text-xl font-semibold tracking-[0.2em]" aria-live="polite">
              {state.kind === "showing" ? state.code.user_code : "····-····"}
            </p>
          </div>
          <ol className="grid gap-1.5 text-left text-sm text-muted-foreground">
            <li>1. On a phone where you're signed in to PocketFolio, scan this with the camera, or open Settings → Link a device.</li>
            <li>2. Check that the code there matches this one, then tap Approve.</li>
          </ol>
          {state.kind === "showing" && (
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="off">
              Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </p>
          )}
        </>
      )}
    </div>
  )
}
