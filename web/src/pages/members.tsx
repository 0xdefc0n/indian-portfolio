// /members (plan §13 item 6): everyone whose statements are in the household. Rename, delete a member or one
// statement, and add statements here; members themselves are created from statements (D19).
import { FileTextIcon, Loader2Icon, PencilIcon, Trash2Icon, UsersIcon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { AddStatementDialog } from "@/components/add-statement-dialog"
import { ProcessingList } from "@/components/jobs"
import { PageShell } from "@/components/app-header"
import { PageTitle } from "@/components/panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Me, type MemberSummary, SignedOut, type StatementKind } from "@/lib/api"
import { day } from "@/lib/format"
import { useJobs } from "@/lib/use-jobs"

const KIND_LABEL: Record<StatementKind, string> = { CDSL: "CDSL eCAS", CAMS: "CAMS", KFINTECH: "KFintech" }
const displayName = (m: MemberSummary) => m.name ?? "Unnamed member"
type Statement = MemberSummary["statements"][number]

function RenameDialog({ member, onClose, onDone }: { member: MemberSummary | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!member) return
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim()
    setBusy(true)
    setError(null)
    try {
      await api.renameMember(member.id, name)
      toast.success("Name updated")
      onDone()
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={member != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename member</DialogTitle>
          <DialogDescription>This is the name PocketFolio shows for {member?.pan_masked}. Statements aren't changed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="member-name">Name</Label>
            <Input id="member-name" name="name" required maxLength={60} autoComplete="off" defaultValue={member?.name ?? ""} className="h-11" />
          </div>
          {error && <p className="text-sm text-loss" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="h-11" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ member, onClose, onDone }: { member: MemberSummary | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = member?.statements.length ?? 0

  async function confirm() {
    if (!member) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteMember(member.id)
      toast.success(`${displayName(member)} removed`)
      onDone()
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={member != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {member ? displayName(member) : "member"}?</DialogTitle>
          <DialogDescription>
            {n ? `Their ${n} statement${n === 1 ? "" : "s"} will be deleted from PocketFolio too.` : "They have no statements."} This can't be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-loss" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" className="h-11" disabled={busy} onClick={confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Delete member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteStatementDialog({ target, onClose, onDone }: {
  target: { member: MemberSummary; statement: Statement } | null
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteStatement(target.statement.id)
      toast.success("Statement deleted")
      onDone()
    } catch (err) {
      if (!(err instanceof SignedOut)) setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this statement?</DialogTitle>
          <DialogDescription>
            {target ? `${KIND_LABEL[target.statement.kind]} as of ${day(target.statement.as_of)} for ${displayName(target.member)}. ` : ""}
            Their other statements stay. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-loss" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" className="h-11" disabled={busy} onClick={confirm}>
            {busy && <Loader2Icon className="animate-spin" />}
            Delete statement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemberCard({ member, onRename, onDelete, onDeleteStatement }: {
  member: MemberSummary
  onRename: () => void
  onDelete: () => void
  onDeleteStatement: (s: Statement) => void
}) {
  const name = displayName(member)
  return (
    <section className="flex min-w-0 flex-col rounded-[22px] bg-surface p-5 ring-1 ring-border sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="grid min-w-0 gap-0.5 text-[15px] font-semibold tracking-tight">
          <span className="truncate">{name}</span>
          <span className="font-mono text-[13px] font-normal text-muted-foreground">{member.pan_masked}</span>
        </h2>
        <div className="-my-1.5 -mr-2 flex shrink-0">
          <Button variant="ghost" size="icon" className="size-11" aria-label={`Rename ${name}`} onClick={onRename}><PencilIcon /></Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label={`Delete ${name}`} onClick={onDelete}><Trash2Icon /></Button>
        </div>
      </div>
      {member.statements.length ? (
        <ul className="divide-y divide-border">
          {member.statements.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-1 text-sm">
              <span className="flex min-w-0 items-center gap-2.5">
                <FileTextIcon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                <Badge variant="secondary">{KIND_LABEL[s.kind]}</Badge>
                <span className="truncate text-muted-foreground"><span className="hidden sm:inline">as of </span>{day(s.as_of)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                {s.holdings_count} holding{s.holdings_count === 1 ? "" : "s"}
                <Button variant="ghost" size="icon" className="-mr-2 size-11" aria-label={`Delete ${KIND_LABEL[s.kind]} statement as of ${day(s.as_of)}`}
                  onClick={() => onDeleteStatement(s)}>
                  <Trash2Icon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No statements yet.</p>
      )}
    </section>
  )
}

function EmptyMembers({ onAdded }: { onAdded: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl bg-surface ring-1 ring-border">
        <UsersIcon className="size-6 text-primary" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">No members yet</h2>
      <p className="mt-3 text-muted-foreground">
        Members appear when you add a statement. Add any family member's statement and we'll file it under the right person automatically.
      </p>
      <div className="mt-8">
        <AddStatementDialog onAdded={onAdded} trigger={<Button size="lg" className="h-11 px-4">Add a statement</Button>} />
      </div>
    </div>
  )
}

export function MembersPage({ me }: { me: Me }) {
  const [members, setMembers] = useState<MemberSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<MemberSummary | null>(null)
  const [deleting, setDeleting] = useState<MemberSummary | null>(null)
  const [deletingStatement, setDeletingStatement] = useState<{ member: MemberSummary; statement: Statement } | null>(null)

  const load = useCallback(() => {
    api.members().then(
      (m) => { setMembers(m); setError(null) },
      (e: Error) => !(e instanceof SignedOut) && setError(e.message),
    )
  }, [])
  useEffect(load, [load])
  // Queued uploads: a finished one reloads the members (plan §13 item 5).
  const { jobs, refresh: refreshJobs } = useJobs(load)
  const reload = useCallback(() => { load(); refreshJobs() }, [load, refreshJobs])
  // "Try again" (here, or in the failed-upload toast: /members?add=1) opens the add-statement dialog.
  const [adding, setAdding] = useState(() => new URLSearchParams(window.location.search).get("add") === "1")
  useEffect(() => {
    if (adding && window.location.search) window.history.replaceState(null, "", window.location.pathname)
  }, [adding])

  const n = members?.length ?? 0
  return (
    <PageShell me={me}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle title="Members" detail={members && n ? `${n} ${n === 1 ? "person" : "people"} in your family portfolio` : undefined} />
        {members && n > 0 && <AddStatementDialog onAdded={reload} />}
      </div>
      <ProcessingList jobs={jobs} onRetry={() => setAdding(true)} onChange={reload} />
      {error && (
        <p className="rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
          Couldn't load members: {error}. Reload to try again.
        </p>
      )}
      {!members && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 rounded-[22px]" />
          <Skeleton className="h-44 rounded-[22px]" />
        </div>
      )}
      {members && n === 0 && <EmptyMembers onAdded={reload} />}
      {members && n > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} onRename={() => setRenaming(m)} onDelete={() => setDeleting(m)}
              onDeleteStatement={(statement) => setDeletingStatement({ member: m, statement })} />
          ))}
        </div>
      )}
      <AddStatementDialog trigger={null} open={adding} onOpenChange={setAdding} onAdded={reload} />
      <RenameDialog key={`r-${renaming?.id}`} member={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); load() }} />
      <DeleteDialog key={`d-${deleting?.id}`} member={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); load() }} />
      <DeleteStatementDialog key={`s-${deletingStatement?.statement.id}`} target={deletingStatement} onClose={() => setDeletingStatement(null)}
        onDone={() => { setDeletingStatement(null); load() }} />
    </PageShell>
  )
}
