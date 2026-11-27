// /link and /link?user_code=… (plan §7.4, §13 item 2): approve a new device that shows a QR code. Signed out, the
// global 401 handler sends people to /login?next=/link?user_code=… and back here afterwards.
import { CheckCircle2Icon, Loader2Icon, MonitorSmartphoneIcon, ScanLineIcon, ShieldAlertIcon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { Link } from "wouter"

import { PageShell } from "@/components/app-header"
import { PageTitle, Panel } from "@/components/panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { api, deviceLine, type LinkRequest, type Me, SignedOut } from "@/lib/api"
import { codeFromScan } from "@/lib/link"

const cleanCode = (s: string) => s.replace(/[^a-z0-9]/gi, "").toUpperCase()

export function LinkPage({ me }: { me: Me }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("user_code"))
  const choose = useCallback((c: string | null) => {
    history.replaceState(null, "", c ? `/link?user_code=${encodeURIComponent(c)}` : "/link")
    setCode(c)
  }, [])
  return (
    <PageShell me={me}>
      <PageTitle title="Link a device" detail="Sign in on a computer or another phone with this account." />
      <div className="grid max-w-xl gap-4">
        {code ? <Approve key={code} code={code} onRestart={() => choose(null)} /> : <Scan onCode={choose} />}
      </div>
    </PageShell>
  )
}

type Phase = { kind: "loading" } | { kind: "ready"; req: LinkRequest } | { kind: "busy"; req: LinkRequest; approve: boolean }
  | { kind: "approved"; req: LinkRequest } | { kind: "denied" } | { kind: "error"; message: string }

function Approve({ code, onRestart }: { code: string; onRestart: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })

  useEffect(() => {
    let stop = false
    api.linkRequest(code).then(
      (req) => !stop && setPhase({ kind: "ready", req }),
      (e: Error) => !stop && !(e instanceof SignedOut) && setPhase({ kind: "error", message: e.message }),
    )
    return () => {
      stop = true
    }
  }, [code])

  async function decide(req: LinkRequest, approve: boolean) {
    setPhase({ kind: "busy", req, approve })
    try {
      await (approve ? api.approveLink(req.user_code) : api.denyLink(req.user_code))
      setPhase(approve ? { kind: "approved", req } : { kind: "denied" })
    } catch (e) {
      if (!(e instanceof SignedOut)) setPhase({ kind: "error", message: (e as Error).message })
    }
  }

  if (phase.kind === "loading") return <Skeleton className="h-72 rounded-[24px]" />
  if (phase.kind === "error" || phase.kind === "denied") {
    return (
      <Panel title={phase.kind === "denied" ? "Declined" : "Can't link this device"}>
        <p className="text-sm text-muted-foreground" role={phase.kind === "error" ? "alert" : "status"}>
          {phase.kind === "denied" ? "Nothing was signed in. The other screen will say so." : phase.message}
        </p>
        <Button variant="outline" className="mt-4 h-11" onClick={onRestart}><ScanLineIcon /> Scan a code</Button>
      </Panel>
    )
  }
  if (phase.kind === "approved") {
    return (
      <Panel title="Device linked">
        <p className="flex items-start gap-2 text-sm" role="status">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-gain" />
          {deviceLine(phase.req.device)} is now signed in to your account. It will open your dashboard in a moment.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          You can sign it out any time in{" "}
          <Link href="/settings" className="text-primary underline-offset-4 hover:underline">Settings → Devices</Link>.
        </p>
      </Panel>
    )
  }

  const req = phase.req
  const busy = phase.kind === "busy"
  return (
    <Panel title="Sign in on this device?">
      <div className="flex items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-border">
          <MonitorSmartphoneIcon className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{req.device.label}</p>
          <p className="text-sm text-muted-foreground">
            {[req.device.city, req.device.country].filter(Boolean).join(", ") || "Location unknown"} · approximate
          </p>
        </div>
      </div>
      <div className="mt-5 rounded-xl bg-background p-4 text-center ring-1 ring-border">
        <p className="text-xs text-muted-foreground">Check that the other screen shows this code</p>
        <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em]">{req.user_code}</p>
      </div>
      <p className="mt-4 flex items-start gap-2 text-sm">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-loss" />
        Only approve if you're signing in on a device in front of you right now. It will see your whole family portfolio.
      </p>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" className="h-11" disabled={busy} onClick={() => decide(req, false)}>
          {busy && !phase.approve && <Loader2Icon className="animate-spin" />}
          Deny
        </Button>
        <Button className="h-11" disabled={busy} onClick={() => decide(req, true)}>
          {busy && phase.approve && <Loader2Icon className="animate-spin" />}
          Approve
        </Button>
      </div>
    </Panel>
  )
}

/** The in-app scanner: qr-scanner uses BarcodeDetector where the browser has it, else its own jsQR worker (§7.4). */
function Scan({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<"starting" | "on" | "unavailable">("starting")
  const [wrong, setWrong] = useState(false)
  const [typed, setTyped] = useState("")

  useEffect(() => {
    let scanner: { stop(): void; destroy(): void } | null = null
    let stop = false
    ;(async () => {
      const { default: QrScanner } = await import("qr-scanner")
      if (stop || !video.current) return
      if (!(await QrScanner.hasCamera())) return setCamera("unavailable")
      const s = new QrScanner(
        video.current,
        (result) => {
          const c = codeFromScan(result.data, window.location.origin)
          if (c) {
            s.stop()
            onCode(c)
          } else setWrong(true)
        },
        { preferredCamera: "environment", returnDetailedScanResult: true, maxScansPerSecond: 5 },
      )
      scanner = s
      await s.start()
      if (stop) s.destroy()
      else setCamera("on")
    })().catch(() => !stop && setCamera("unavailable"))
    return () => {
      stop = true
      scanner?.destroy()
    }
  }, [onCode])

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const c = cleanCode(typed)
    if (c.length === 8) onCode(c)
  }

  return (
    <Panel title="Scan the QR code">
      <p className="text-sm text-muted-foreground">
        On the other device, open PocketFolio and choose <span className="font-medium text-foreground">Log in with QR</span>.
        Then point this camera at the code.
      </p>
      <div className="relative mt-4 aspect-square w-full max-w-[320px] overflow-hidden rounded-xl bg-background ring-1 ring-border">
        <video ref={video} muted playsInline className="size-full object-cover" aria-label="Camera view" />
        {camera !== "on" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
            {camera === "starting" ? <Loader2Icon className="size-5 animate-spin" aria-label="Starting the camera" /> : "No camera available here. Type the code instead."}
          </div>
        )}
      </div>
      {wrong && <p className="mt-3 text-sm text-loss" role="alert">That's not a PocketFolio sign-in code.</p>}
      <form onSubmit={submit} className="mt-5 grid gap-2">
        <Label htmlFor="user-code">Or type the code shown on the other screen</Label>
        <div className="flex gap-2">
          <Input
            id="user-code"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            className="h-11 font-mono tracking-[0.2em] uppercase"
          />
          <Button type="submit" className="h-11" disabled={cleanCode(typed).length !== 8}>Continue</Button>
        </div>
      </form>
    </Panel>
  )
}
