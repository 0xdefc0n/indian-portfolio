import { ChevronDownIcon, FileUpIcon, Loader2Icon, PlusIcon } from "lucide-react"
import { type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { type AddedStatement, ApiFailure, api, SignedOut } from "@/lib/api"

const PASSWORD_HINT =
  "For a CDSL eCAS this is usually the PAN in capital letters. For CAMS/KFintech it's the password you chose when requesting it."

/** Say whose portfolio it went to (plan §13 item 5). The dashboard update arrives with snapshots (M10). */
function report({ member }: AddedStatement) {
  const name = member.name ?? member.pan_masked
  toast.success("Statement added", {
    description: member.created ? `New member added: ${name} (${member.pan_masked})` : `Added to ${name}`,
  })
}

type Problem = { message: string; hint?: string }

/** Only the file and an optional password (D19). Members' PANs and pending passwords are tried on the server. */
function UploadForm({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    const password = showPassword ? String(new FormData(e.currentTarget).get("password") ?? "") : ""
    setBusy(true)
    setProblem(null)
    try {
      report(await api.addStatement(file, password))
      onDone()
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
      <Button type="submit" className="h-11" disabled={busy || !file}>
        {busy && <Loader2Icon className="animate-spin" />}
        {busy ? "Reading statement…" : "Add statement"}
      </Button>
    </form>
  )
}

/** CDSL OTP fetch isn't deployed (D8): shown as coming soon (plan §13 item 5). */
function OtpComingSoon({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">Fetch from CDSL with OTP</span>
        <Badge variant="secondary">Coming soon</Badge>
      </div>
      <p className="text-muted-foreground">
        Soon you'll be able to fetch a CDSL statement with the OTP sent to your phone. For now, download it from{" "}
        <a className="-my-2 py-2 text-primary underline-offset-4 hover:underline" href="https://www.cdslindia.com/CAS/LoginCAS.aspx" target="_blank" rel="noopener noreferrer">
          CDSL
        </a>{" "}
        and upload the PDF.
      </p>
      <Button type="button" variant="outline" className="h-11" onClick={onUpload}>Upload a PDF</Button>
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
            Add any family member's statement. We'll file it under the right person automatically.
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
            <OtpComingSoon onUpload={() => setTab("upload")} />
          </TabsContent>
          <TabsContent value="request" className="pt-4">
            <RequestStatementForm onUpload={() => setTab("upload")} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
