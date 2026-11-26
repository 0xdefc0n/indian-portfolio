// The user's SIP changes (M12, owner request 2026-11-26): skip the next instalment, or cancel the SIP.
//
// PocketFolio doesn't place, skip or stop SIPs with a broker or fund house. These record what the user did there, so
// the estimates after the last statement (engine projection.py) match it until a newer statement shows the truth:
//   - skip: one instalment, the next one only (its due date is today or later). A new skip replaces an earlier
//     upcoming one; it can be undone.
//   - cancel: no instalment is estimated from today on. Final in PocketFolio (the UI confirms first), but a newer
//     statement that shows instalments after it wins.
// Which SIP (fund ISIN and folio) is sealed with the household key; `sip_key` is an HMAC, so the row finds the SIP
// again without saying which it is. Every id from the client goes through the tenant guard.
import { hmacHex } from './crypto'
import { ApiError } from './errors'
import { addDays, istToday, ymdToIso } from '../market/amfi'
import type { Tenant } from './tenant'

export const sipFieldKey = (id: string) => `sip/${id}`

/** A household can't pile up more than this (skips of past instalments are dropped on the next skip). */
export const MAX_OVERRIDES = 200
/** How far ahead "the next instalment" can be (a quarterly SIP's next is ≤ ~92 days away). */
export const SKIP_AHEAD_DAYS = 100

const ISIN_RE = /^INF[A-Z0-9]{9}$/
const FOLIO_RE = /^[A-Za-z0-9/ .,-]{1,60}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export type SipRef = { member_id: string; isin: string; folio: string | null }

/** The SIP named in a request body, or a 400. The member is checked against the household by the caller. */
export function parseSipRef(body: unknown): SipRef {
  const b = (body ?? {}) as Record<string, unknown>
  const isin = typeof b.isin === 'string' ? b.isin.toUpperCase() : ''
  const folio = b.folio === null || b.folio === undefined ? null : typeof b.folio === 'string' ? b.folio.trim() : undefined
  if (typeof b.member_id !== 'string' || !ISIN_RE.test(isin) || folio === undefined || (folio !== null && !FOLIO_RE.test(folio))) {
    throw new ApiError(400, 'bad_request')
  }
  return { member_id: b.member_id, isin, folio }
}

const sipKey = (t: Tenant, ref: SipRef) => hmacHex(t.env.PAN_PEPPER, `sip:${t.householdId}|${ref.member_id}|${ref.folio ?? ''}|${ref.isin}`)
const todayIso = (now: number) => ymdToIso(istToday(now))

/** Insert one override after `before` (same batch). Returns rows inserted (0: a duplicate, a cancelled SIP or the cap). */
async function insert(t: Tenant, ref: SipRef, key: string, kind: 'skip' | 'cancel', due: string, now: number, before: D1PreparedStatement[]): Promise<number> {
  const id = crypto.randomUUID()
  const vault = await t.vault()
  const sealed = await vault.sealText(sipFieldKey(id), JSON.stringify({ isin: ref.isin, folio: ref.folio }))
  const db = t.env.DB
  const results = await db.batch([
    ...before,
    db
      .prepare(
        `INSERT INTO sip_override (id, household_id, member_id, sip_key, kind, due, sip_enc, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE (SELECT COUNT(*) FROM sip_override WHERE household_id = ?2) < ?9
           AND NOT EXISTS (SELECT 1 FROM sip_override WHERE household_id = ?2 AND sip_key = ?4 AND kind = 'cancel')
         ON CONFLICT DO NOTHING`,
      )
      .bind(id, t.householdId, ref.member_id, key, kind, due, sealed, now, MAX_OVERRIDES),
  ])
  return results.at(-1)?.meta.changes ?? 0
}

/** Skip the SIP's next instalment (due today or later). Replaces an earlier upcoming skip of the same SIP. */
export async function skipNext(t: Tenant, ref: SipRef, due: unknown, now = Date.now()): Promise<{ due: string }> {
  const today = todayIso(now)
  const last = ymdToIso(addDays(istToday(now), SKIP_AHEAD_DAYS))
  if (typeof due !== 'string' || !ISO_RE.test(due) || Number.isNaN(Date.parse(due)) || due < today || due > last) {
    throw new ApiError(400, 'bad_due_date')
  }
  const key = await sipKey(t, ref)
  const db = t.env.DB
  const cancelled = await db.prepare(`SELECT 1 FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'cancel'`).bind(t.householdId, key).first()
  if (cancelled) throw new ApiError(409, 'sip_cancelled')
  // one skip per SIP: the upcoming one replaces any other (past skips have done their job and go too)
  const clear = db.prepare(`DELETE FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'skip' AND due <> ?3`).bind(t.householdId, key, due)
  if (!(await insert(t, ref, key, 'skip', due, now, [clear]))) {
    const same = await db.prepare(`SELECT 1 FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'skip' AND due = ?3`).bind(t.householdId, key, due).first()
    if (!same) throw new ApiError(429, 'too_many_changes')
  }
  return { due }
}

/** Undo a skip that hasn't come yet. */
export async function undoSkip(t: Tenant, ref: SipRef, now = Date.now()): Promise<number> {
  const key = await sipKey(t, ref)
  const res = await t.env.DB.prepare(`DELETE FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'skip' AND due >= ?3`)
    .bind(t.householdId, key, todayIso(now))
    .run()
  return res.meta.changes ?? 0
}

/** Cancel the SIP from today. Idempotent; there is no undo. */
export async function cancelSip(t: Tenant, ref: SipRef, now = Date.now()): Promise<{ cancelled_on: string; changed: boolean }> {
  const key = await sipKey(t, ref)
  const today = todayIso(now)
  const db = t.env.DB
  const clear = db.prepare(`DELETE FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'skip'`).bind(t.householdId, key)
  const changed = await insert(t, ref, key, 'cancel', today, now, [clear])
  const row = await db.prepare(`SELECT due FROM sip_override WHERE household_id = ?1 AND sip_key = ?2 AND kind = 'cancel'`).bind(t.householdId, key).first<{ due: string }>()
  if (!row) throw new ApiError(429, 'too_many_changes')
  return { cancelled_on: row.due, changed: changed > 0 }
}
