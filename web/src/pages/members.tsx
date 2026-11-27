// /members (plan §13 item 6): everyone whose statements are in the household. Rename, delete a member or one
// statement, and add statements here; members themselves are created from statements (D19). Each member's FD, PPF
// and EPF (M19) are listed below their statements, with Add.
import { FileTextIcon, Loader2Icon, PencilIcon, Trash2Icon, UsersIcon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { type AddPick, AddAssetDialog, AddAssetTrigger, type Have } from "@/components/add-asset-dialog"
import { type AssetDialogState, AssetDialogs, type AssetGroup } from "@/components/asset-dialogs"
import { AddAssetButton, FixedIncomeList } from "@/components/fixed-income"
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
import { type AssetRow, useAssets, valued } from "@/lib/assets"
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

function DeleteDialog({ member, assets, onClose, onDone }: { member: MemberSummary | null; assets: number; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = member?.statements.length ?? 0
  const what = [n && `${n} statement${n === 1 ? "" : "s"}`, assets && `${assets} entr${assets === 1 ? "y" : "ies"} added by hand (FD, PPF, EPF, gold or silver)`].filter(Boolean).join(" and ")

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
            {what ? `Their ${what} will be deleted from PocketFolio too.` : "They have no statements."} This can't be undone.
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

function AssetSection({ rows, onAdd, onAction, onChanged }: { rows: AssetRow[]; onAdd: (g: AssetGroup) => void; onAction: (s: AssetDialogState) => void; onChanged: () => void }) {
  return (
    <div className="mt-4 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">FD, PPF, EPF and gold</h3>
        <span className="flex gap-2">
          <AddAssetButton onClick={() => onAdd("fixed")} label="FD, PPF, EPF" />
          <AddAssetButton onClick={() => onAdd("metal")} label="Gold, silver" />
        </span>
      </div>
      {rows.length ? <FixedIncomeList rows={rows} onAction={onAction} onChanged={onChanged} compact /> : <p className="mt-1 text-sm text-muted-foreground">None yet.</p>}
    </div>
  )
}

function MemberCard({ member, onRename, onDelete, onDeleteStatement, assets }: {
  member: MemberSummary
  onRename: () => void
  onDelete: () => void
  onDeleteStatement: (s: Statement) => void
  assets: React.ReactNode
}) {
  const name = displayName(member)
  return (
    <section className="flex min-w-0 flex-col glass rounded-[24px] p-5 sm:p-6">
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
      {assets}
    </section>
  )
}

function EmptyMembers({ onAdd }: { onAdd: () => void }) {
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
        <Button size="lg" className="h-11 px-4" onClick={onAdd}>Add asset</Button>
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
  // "Try again" (here, or in the failed-upload toast: /members?add=1) opens Add asset on the statement upload.
  const [add, setAdd] = useState<AddPick | "list" | null>(() => new URLSearchParams(window.location.search).get("add") === "1" ? "mf" : null)
  useEffect(() => {
    if (add && window.location.search) window.history.replaceState(null, "", window.location.pathname)
  }, [add])

  // FD, PPF and EPF (M19), gold, silver and SGBs (M29), valued in the browser with the shared calculator.
  const assets = useAssets()
  const rows = useMemo(() => valued(assets.assets ?? [], assets.rates), [assets.assets, assets.rates])
  const [assetDlg, setAssetDlg] = useState<AssetDialogState>(null)
  const pick = useMemo(() => (members ?? []).map((m) => ({ id: m.id, name: displayName(m) })), [members])
  // what's here already, for the Add asset list (this page has statements, not holdings: CAMS / KFintech → funds, CDSL → shares)
  const have = useMemo<Have>(() => {
    const h: Have = { counting: "statements" }
    for (const m of members ?? []) for (const st of m.statements) {
      if (st.kind === "CDSL") h.listed = (h.listed ?? 0) + 1
      else h.mf = (h.mf ?? 0) + 1
    }
    for (const a of assets.assets ?? []) h[a.type] = (h[a.type] ?? 0) + 1
    return h
  }, [members, assets.assets])
  const unassigned = rows.filter((r) => !r.member_id || !members?.some((m) => m.id === r.member_id))
  const section = (memberId: string | null, list: AssetRow[]) => (
    <AssetSection rows={list} onAdd={(group) => setAssetDlg({ kind: "add", member: memberId, group })} onAction={setAssetDlg} onChanged={assets.reload} />
  )

  const n = members?.length ?? 0
  return (
    <PageShell me={me}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle title="Members" detail={members && n ? `${n} ${n === 1 ? "person" : "people"} in your family portfolio` : undefined} />
        {members && n > 0 && <AddAssetTrigger onClick={() => setAdd("list")} />}
      </div>
      <ProcessingList jobs={jobs} onRetry={() => setAdd("mf")} onChange={reload} />
      {error && (
        <p className="rounded-xl bg-surface p-4 text-sm text-loss ring-1 ring-border" role="alert">
          Couldn't load members: {error}. Reload to try again.
        </p>
      )}
      {!members && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 rounded-[24px]" />
          <Skeleton className="h-44 rounded-[24px]" />
        </div>
      )}
      {members && n === 0 && <EmptyMembers onAdd={() => setAdd("list")} />}
      {members && n > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} onRename={() => setRenaming(m)} onDelete={() => setDeleting(m)}
              onDeleteStatement={(statement) => setDeletingStatement({ member: m, statement })}
              assets={section(m.id, rows.filter((r) => r.member_id === m.id))} />
          ))}
        </div>
      )}
      {members && unassigned.length > 0 && (
        <section className="glass rounded-[24px] p-5 sm:p-6" aria-label="Not filed under a member">
          <h2 className="text-[15px] font-semibold tracking-tight">Not filed under a member</h2>
          <p className="mt-1 text-sm text-muted-foreground">Added before any statement. Edit one to pick whose it is.</p>
          <FixedIncomeList rows={unassigned} onAction={setAssetDlg} onChanged={assets.reload} />
        </section>
      )}
      <AssetDialogs state={assetDlg} members={pick} rates={assets.rates} onClose={() => setAssetDlg(null)} onSaved={assets.reload} onState={setAssetDlg} />
      <AddAssetDialog trigger={null} open={!!add} start={add && add !== "list" ? add : undefined} onOpenChange={(o) => { if (!o) setAdd(null) }}
        onAdded={reload} onAssetSaved={assets.reload} members={pick} rates={assets.rates} have={have} />
      <RenameDialog key={`r-${renaming?.id}`} member={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); load() }} />
      <DeleteDialog key={`d-${deleting?.id}`} member={deleting} assets={rows.filter((r) => r.member_id === deleting?.id).length} onClose={() => setDeleting(null)}
        onDone={() => { setDeleting(null); load(); assets.reload() }} />
      <DeleteStatementDialog key={`s-${deletingStatement?.statement.id}`} target={deletingStatement} onClose={() => setDeletingStatement(null)}
        onDone={() => { setDeletingStatement(null); load() }} />
    </PageShell>
  )
}
