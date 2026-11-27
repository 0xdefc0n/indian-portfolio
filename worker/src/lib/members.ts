// Members of a household (plan §6 member, §9.2). A member is created from a statement (D19, lib/statements.ts);
// here are the row builder, list, rename and delete. PANs are stored three ways: an HMAC for lookups, the sealed PAN
// (it is the default PDF password) and a masked copy for display. Names are sealed.
import { deleteBlobs } from './blob'
import { hmacHex, type Vault } from './crypto'
import { requestRebuild } from './snapshot'
import type { Tenant } from './tenant'

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const MAX_NAME = 60

/** Upper-case, whitespace removed; null if it isn't a PAN. */
export function normalizePan(input: string): string | null {
  const pan = input.replace(/\s+/g, '').toUpperCase()
  return PAN_RE.test(pan) ? pan : null
}

/** "AB••••••4F" (CLAUDE.md, plan §6). */
export const maskPan = (pan: string) => `${pan.slice(0, 2)}••••••${pan.slice(-2)}`

/** HMAC-SHA256(PAN_PEPPER, PAN), the household-scoped lookup key. Same PAN → same value in every household. */
export const panHmac = (env: { PAN_PEPPER: string }, pan: string) => hmacHex(env.PAN_PEPPER, `pan:${pan}`)

/** AAD names for sealed columns: a member's fields, and a pending KFintech password (keyed by PAN, D9/D19). */
export const fieldKey = {
  pan: (memberId: string) => `member/${memberId}/pan`,
  name: (memberId: string) => `member/${memberId}/name`,
  pendingPassword: (hmac: string) => `pending/${hmac}/password`,
  /** The verified password of a queued upload (password_source = 'typed'), cleared with the parked PDF. */
  jobPassword: (jobId: string) => `job/${jobId}/password`,
}

/** A display name we accept from a rename: trimmed, 1–60 characters, no control characters. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  // oxlint-disable-next-line no-control-regex
  const name = input.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return name.length >= 1 && [...name].length <= MAX_NAME ? name : null
}

/**
 * The INSERT for a new member (used by storeStatement, and by tests). Returns the id so the caller can file
 * statements under it in the same batch.
 *
 * With `maxMembers` (storeStatement) the insert is race-safe instead: it adds nothing when the household already
 * has that many members or already has this PAN (a concurrent upload won), so the caller looks the member up by
 * pan_hmac and a missing member means the household is full.
 */
export async function memberInsert(
  t: Tenant,
  vault: Vault,
  input: { pan: string; name: string | null; id?: string; now?: number; maxMembers?: number },
): Promise<{ id: string; stmt: D1PreparedStatement }> {
  const pan = normalizePan(input.pan)
  if (!pan) throw new TypeError('not a PAN')
  const id = input.id ?? crypto.randomUUID()
  const name = input.name ? cleanName(input.name) : null
  const sql =
    input.maxMembers === undefined
      ? `INSERT INTO member (id, household_id, pan_hmac, pan_enc, pan_masked, display_name_enc, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      : `INSERT INTO member (id, household_id, pan_hmac, pan_enc, pan_masked, display_name_enc, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE (SELECT COUNT(*) FROM member WHERE household_id = ?2) < ${Math.trunc(input.maxMembers)}
         ON CONFLICT (household_id, pan_hmac) DO NOTHING`
  const stmt = t.env.DB.prepare(sql).bind(
    id,
    t.householdId,
    await panHmac(t.env, pan),
    await vault.sealText(fieldKey.pan(id), pan),
    maskPan(pan),
    name ? await vault.sealText(fieldKey.name(id), name) : null,
    input.now ?? Date.now(),
  )
  return { id, stmt }
}

export type StatementSummary = { id: string; kind: 'CDSL' | 'CAMS' | 'KFINTECH'; as_of: string; holdings_count: number }
export type MemberView = { id: string; name: string | null; pan_masked: string; statements: StatementSummary[] }

type MemberRow = { id: string; pan_masked: string; display_name_enc: number[] | null }
type StatementRow = StatementSummary & { member_id: string }
type HouseholdKeyRow = { dek_wrapped: number[]; kek_version: number }

/** Every member with their statements (newest first). One D1 round trip: the key, members and statements in a batch. */
export async function listMembers(t: Tenant): Promise<MemberView[]> {
  const db = t.env.DB
  const [keyRes, memberRes, statementRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db.prepare('SELECT id, pan_masked, display_name_enc FROM member WHERE household_id = ?1 ORDER BY created_at, id').bind(t.householdId),
    db
      .prepare(
        `SELECT id, member_id, kind, as_of, holdings_count FROM statement WHERE household_id = ?1
         ORDER BY as_of DESC, created_at DESC`,
      )
      .bind(t.householdId),
  ])
  const members = (memberRes?.results ?? []) as MemberRow[]
  if (!members.length) return []
  const keyRow = keyRes?.results[0] as HouseholdKeyRow | undefined
  if (!keyRow) return []
  const vault = await t.vaultFromRow(keyRow)
  const byMember = new Map<string, StatementSummary[]>()
  for (const s of (statementRes?.results ?? []) as StatementRow[]) {
    const list = byMember.get(s.member_id) ?? []
    list.push({ id: s.id, kind: s.kind, as_of: s.as_of, holdings_count: s.holdings_count })
    byMember.set(s.member_id, list)
  }
  return Promise.all(
    members.map(async (m) => ({
      id: m.id,
      name: m.display_name_enc ? await vault.openText(fieldKey.name(m.id), m.display_name_enc) : null,
      pan_masked: m.pan_masked,
      statements: byMember.get(m.id) ?? [],
    })),
  )
}

/** Rename (the display name the dashboard shows). False if the member isn't this household's. */
export async function renameMember(t: Tenant, memberId: string, name: string, audit: D1PreparedStatement): Promise<boolean> {
  const vault = await t.vault()
  const sealed = await vault.sealText(fieldKey.name(memberId), name)
  const [res] = await t.env.DB.batch([
    t.env.DB.prepare('UPDATE member SET display_name_enc = ?1 WHERE id = ?2 AND household_id = ?3').bind(sealed, memberId, t.householdId),
    audit,
  ])
  const renamed = (res?.meta.changes ?? 0) > 0
  if (renamed) await requestRebuild(t.env, t.householdId) // the dashboard shows the name
  return renamed
}

/**
 * Delete a member, their statements, tradebooks and any queued job for them (rows cascade), then their R2 blobs:
 * statement and tradebook JSON under h/ and parked PDFs under tmp/. Rows go first, in one transaction, so nothing ever points at a missing
 * blob; a blob delete that fails leaves only an unreferenced object, which account deletion's prefix sweep removes.
 * False if the member isn't this household's.
 */
export async function deleteMember(t: Tenant, memberId: string, audit: D1PreparedStatement): Promise<boolean> {
  const db = t.env.DB
  const [statementKeys, jobKeys, tradebookKeys, del] = await db.batch<{ blob_key: string }>([
    db.prepare('SELECT blob_key FROM statement WHERE member_id = ?1 AND household_id = ?2').bind(memberId, t.householdId),
    db.prepare('SELECT blob_key FROM parse_job WHERE member_id = ?1 AND household_id = ?2 AND blob_key IS NOT NULL').bind(memberId, t.householdId),
    db.prepare('SELECT blob_key FROM tradebook WHERE member_id = ?1 AND household_id = ?2').bind(memberId, t.householdId), // M21
    db.prepare('DELETE FROM member WHERE id = ?1 AND household_id = ?2').bind(memberId, t.householdId),
    audit, // written only if the DELETE removed the row (auditStatement onlyIfChanged)
  ])
  if (!(del?.meta.changes ?? 0)) return false
  const keys = [...(statementKeys?.results ?? []), ...(jobKeys?.results ?? []), ...(tradebookKeys?.results ?? [])].map((r) => r.blob_key)
  try {
    await deleteBlobs(t.env, t.householdId, keys)
  } catch (err) {
    console.error('blob_delete_failed', (err as Error).name, keys.length)
  }
  await requestRebuild(t.env, t.householdId)
  return true
}
