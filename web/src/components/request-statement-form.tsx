import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MailCheckIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, type StatementRequestResult } from "@/lib/api"
import { day } from "@/lib/format"

const PAN_PATTERN = "[A-Za-z]{5}[0-9]{4}[A-Za-z]"
const today = () => new Date().toISOString().slice(0, 10)

function Field({ id, label, hint, ...props }: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function PasswordBox({ password }: { password: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
      <div>
        <div className="text-xs text-muted-foreground">PDF password</div>
        <code className="text-base font-semibold tracking-wide">{password}</code>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(password)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

type Sent = StatementRequestResult & { email: string; from: string; to: string }

/** Ask KFintech to email a detailed statement covering every CAMS + KFintech folio. */
export function RequestStatementForm({ onUpload }: { onUpload: () => void }) {
  const [auto, setAuto] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Sent | null>(null)

  useEffect(() => {
    api.config().then((c) => setAuto(c.features.kfintech_auto), () => setAuto(false))
  }, [])

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body = {
      pan: String(f.get("pan")),
      email: String(f.get("email")),
      from_date: String(f.get("from")),
      to_date: String(f.get("to")),
      password: String(f.get("password") ?? ""),
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.requestStatement(body)
      setResult({ ...res, email: body.email, from: body.from_date, to: body.to_date })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result?.mode === "sent") {
    return (
      <div className="grid gap-4">
        <div className="flex gap-3">
          <MailCheckIcon className="mt-0.5 size-5 shrink-0 text-gain" />
          <div className="text-sm">
            <p className="font-medium">Request sent to KFintech</p>
            <p className="mt-1 text-muted-foreground">
              The statement will arrive at {result.email} in a few minutes. It's emailed only to the address registered with the folios.
            </p>
          </div>
        </div>
        <PasswordBox password={result.password} />
        <p className="text-xs text-muted-foreground">
          When it arrives, upload it in the Upload PDF tab. You can leave the password empty; this app remembers it until the PDF is added.
        </p>
        <Button type="button" onClick={onUpload}>Go to Upload PDF</Button>
      </div>
    )
  }

  if (result?.mode === "manual") {
    return (
      <div className="grid gap-4 text-sm">
        <ol className="grid list-decimal gap-2 pl-5 marker:text-muted-foreground">
          <li>
            Open{" "}
            <a className="-my-2 inline-flex items-center gap-1 py-2 text-primary underline-offset-4 hover:underline" href={result.form_url} target="_blank" rel="noopener noreferrer">
              KFintech's statement page <ExternalLinkIcon className="size-3.5" />
            </a>
          </li>
          <li>Choose a <strong>Detailed</strong> statement for a specific period, {day(result.from)} to {day(result.to)}.</li>
          <li>Enter the PAN and {result.email}, then set this password:</li>
        </ol>
        <PasswordBox password={result.password} />
        <p className="text-xs text-muted-foreground">
          When the email arrives, upload the PDF in the Upload PDF tab and leave the password empty; this app remembers it.
        </p>
        <Button type="button" onClick={onUpload}>Go to Upload PDF</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        KFintech emails a detailed statement of every CAMS and KFintech folio. Starting from the first investment gives invested amount, returns and XIRR for every fund.
      </p>
      <Field id="r-pan" name="pan" label="PAN" required maxLength={10} pattern={PAN_PATTERN} autoComplete="off"
        placeholder="ABCDE1234F" className="uppercase" />
      <Field id="r-email" name="email" label="Registered email" type="email" required autoComplete="email"
        hint="The email on the mutual fund folios. The statement is only sent there." />
      <div className="grid grid-cols-2 gap-3">
        <Field id="r-from" name="from" label="From" type="date" required defaultValue="2000-01-01" max={today()} />
        <Field id="r-to" name="to" label="To" type="date" required defaultValue={today()} max={today()} />
      </div>
      <Field id="r-password" name="password" label="PDF password (optional)" type="text" autoComplete="off"
        hint="Leave empty to generate one. 8+ characters with upper and lower case, a number and a symbol; not the PAN." />
      {auto && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          The PAN and email go to the KFintech request service on RapidAPI (run by CASParser), which fills in KFintech's form for you.
        </p>
      )}
      {error && <p className="text-sm text-loss" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || auto === null}>
        {busy && <Loader2Icon className="animate-spin" />}
        {busy ? "Requesting… this can take a minute" : auto ? "Request statement" : "Get request steps"}
      </Button>
    </form>
  )
}
