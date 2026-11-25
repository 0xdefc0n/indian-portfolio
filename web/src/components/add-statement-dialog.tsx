import { FileUpIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RequestStatementForm } from "@/components/request-statement-form"
import { api, type SaveResult } from "@/lib/api"

const PAN_PATTERN = "[A-Za-z]{5}[0-9]{4}[A-Za-z]"

/** Toast the outcome of a save and report whether anything usable was added. */
function report(res: SaveResult): boolean {
  const parsed = res.parsed ?? []
  const ok = parsed.filter((p) => p.ok)
  if (ok.length) {
    const n = ok.reduce((s, p) => s + (p.holdings ?? 0), 0)
    toast.success("Statement added", { description: `${n} holding${n === 1 ? "" : "s"} found.` })
    return true
  }
  toast.error("Statement saved, but it couldn't be read", {
    description: parsed[0]?.error ?? "Only CDSL consolidated statements are supported right now.",
  })
  return false
}

function Field({ id, label, hint, ...props }: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.upload(String(f.get("pan")), String(f.get("password") ?? ""), file)
      if (report(res)) onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field id="u-pan" name="pan" label="PAN" required maxLength={10} pattern={PAN_PATTERN} autoComplete="off"
        placeholder="ABCDE1234F" className="uppercase" hint="The member this statement belongs to." />
      <div className="grid gap-2">
        <Label htmlFor="u-file">Statement PDF</Label>
        <label
          htmlFor="u-file"
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm transition-colors hover:bg-muted/60 focus-within:outline-2 focus-within:outline-ring"
        >
          <FileUpIcon className="size-5 text-muted-foreground" />
          <span className={file ? "font-medium" : "text-muted-foreground"}>{file ? file.name : "Choose a PDF"}</span>
          <input id="u-file" type="file" accept="application/pdf" required className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="text-xs text-muted-foreground">
          A{" "}
          <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">
            CDSL
          </a>{" "}
          statement, or a{" "}
          <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.camsonline.com" target="_blank" rel="noopener noreferrer">
            CAMS / KFintech
          </a>{" "}
          one. Choose “Detailed” with the earliest start date to see gains.
        </p>
      </div>
      <Field id="u-password" name="password" label="PDF password" type="password" autoComplete="off"
        hint="Leave empty if it's the PAN (CDSL) or if you requested the statement here. Used once to read the file, never saved." />
      {error && <p className="text-sm text-loss" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !file}>
        {busy && <Loader2Icon className="animate-spin" />}
        {busy ? "Adding statement…" : "Add statement"}
      </Button>
    </form>
  )
}

function OtpForm({ onDone }: { onDone: () => void }) {
  const [session, setSession] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function sendOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const res = await api.requestOtp(String(f.get("pan")), String(f.get("bo")), String(f.get("dob")))
      setSession(res.session_id)
      toast.info(res.msg || "OTP sent to the mobile registered with CDSL")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!session) return
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const res = await api.verifyOtp(session, String(f.get("otp")))
      if (report(res)) onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {!session ? (
        <form onSubmit={sendOtp} className="grid gap-4">
          <Field id="o-pan" name="pan" label="PAN" required maxLength={10} pattern={PAN_PATTERN} autoComplete="off"
            placeholder="ABCDE1234F" className="uppercase" />
          <Field id="o-bo" name="bo" label="CDSL BO ID" required inputMode="numeric" maxLength={16} pattern="[0-9]{16}"
            placeholder="16 digits" hint="Shown in your broker app under profile or demat details." />
          <Field id="o-dob" name="dob" label="Date of birth" type="date" required />
          {error && <p className="text-sm text-loss" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? "Contacting CDSL… about 20 seconds" : "Send OTP"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="grid gap-4">
          <Field id="o-otp" name="otp" label="OTP" required inputMode="numeric" maxLength={8} pattern="[0-9]{4,8}"
            autoComplete="one-time-code" autoFocus hint="Sent by CDSL to the mobile registered on the demat account." />
          {error && <p className="text-sm text-loss" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? "Fetching statement…" : "Fetch statement"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { setSession(null); setError(null) }}>
            Use different details
          </Button>
        </form>
      )}
    </div>
  )
}

type Tab = "upload" | "otp" | "request"

export function AddStatementDialog({
  onAdded,
  trigger,
  defaultTab = "upload",
}: {
  onAdded: () => void
  trigger?: React.ReactNode
  defaultTab?: Tab
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(defaultTab)
  const done = () => {
    setOpen(false)
    onAdded()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setTab(defaultTab)
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon />
            Add statement
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a statement</DialogTitle>
          <DialogDescription>
            A family member's CDSL or CAMS / KFintech statement. Funds in both are counted once, using the newer figures.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-2">
          <TabsList className="h-10 w-full">
            <TabsTrigger value="upload">Upload<span className="hidden sm:inline">&nbsp;PDF</span></TabsTrigger>
            <TabsTrigger value="otp"><span className="hidden sm:inline">Fetch with&nbsp;</span>OTP</TabsTrigger>
            <TabsTrigger value="request">Request</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="pt-4">
            <UploadForm onDone={done} />
          </TabsContent>
          <TabsContent value="otp" className="pt-4">
            <OtpForm onDone={done} />
          </TabsContent>
          <TabsContent value="request" className="pt-4">
            <RequestStatementForm onUpload={() => setTab("upload")} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
