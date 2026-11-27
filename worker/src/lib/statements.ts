// Statements: upload (plan §10.1 A–C, D19), store and delete. The upload never stores a PDF: it is verified with the
// pdf.js pre-check, parsed in memory on a leased engine slot, and only the parsed JSON is kept, compressed and sealed
// in R2. Members come from the statement's own PAN, never from the client (D19).
//
// Privacy (§0.1): PANs, names, passwords and statement contents never reach a log, an error or a response. Logs carry
// the outcome code, page count, slot and durations only.
import { deleteBlobs, putJsonBlob } from './blob'
import { type Bytes, hmacHex, type Vault } from './crypto'
import { engineApi, type EngineParse, type ParsedStatement } from './engine-client'
import { parkUpload, type QueuedUpload } from './jobs'
import { type MarketMessage, marketQueue, sendPrices } from '../market/jobs'
import { equityIsins, trackEquities } from '../market/prices'
import { pendingBackfillStatement, resolveTrackedStatement } from '../market/store'
import { ApiError, notFound } from './errors'
import { failQuota, LIMITS, uploadQuota } from './limits'
import { cleanName, fieldKey, maskPan, memberInsert, normalizePan, panHmac } from './members'
import { precheckPdf } from './pdfcheck'
import { requestRebuild } from './snapshot'
import { isQuotaRefusal, quotaStatement, quotaWindow, refusal, secondsLeft, takeQuota } from './quota'
import type { Tenant } from './tenant'

export type StatementKind = 'CDSL' | 'CAMS' | 'KFINTECH'
export type PasswordSource = 'typed' | 'pan' | 'kfintech_pending' | 'none'

export type AddedStatement = {
  statement: { id: string; kind: StatementKind; as_of: string; holdings_count: number; warnings_count: number }
  member: { id: string; name: string | null; pan_masked: string; created: boolean }
}

/** Codes the engine can fail a verified PDF with (§10.1 C5). Anything else is reported as parse_error. */
const ENGINE_FAILURES = new Set(['parse_error', 'multi_pan', 'precheck_disagree', 'parse_timeout'])
const MAX_PASSWORD = 128
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

type MemberRow = { id: string; pan_hmac: string; pan_enc: number[]; pan_masked: string; display_name_enc: number[] | null }
type PendingRow = { pan_hmac: string; password_enc: number[] }
type Candidate = { password: string; source: PasswordSource; pan?: string; pendingPanHmac?: string }

/** The bytes' duplicate key (§10.1 A3). Keyed with PAN_PEPPER, so it says nothing about the file without the secret. */
export const contentHash = (env: { PAN_PEPPER: string }, bytes: Uint8Array<ArrayBuffer>) => hmacHex(env.PAN_PEPPER, bytes)

export const isPdf = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

/**
 * POST /api/statements. Throws ApiError for every refusal; nothing is stored unless it succeeds. With a free engine
 * slot the statement is parsed and stored now (`added`, the direct path); otherwise the verified PDF is parked
 * encrypted for the parse consumer (`queued`, §10.1 D). `audit` is the statement_added row of the direct path.
 */
export async function uploadStatement(
  t: Tenant,
  input: { bytes: Uint8Array<ArrayBuffer>; password: string | null },
  audit: D1PreparedStatement,
): Promise<{ added: AddedStatement } | { queued: QueuedUpload }> {
  const { env } = t
  const db = env.DB
  const started = Date.now()
  const { bytes } = input
  // A1: size and magic bytes (the route already refused bodies that declare more than the limit).
  if (bytes.length > LIMITS.uploadBytes) throw new ApiError(413, 'file_too_large')
  if (!isPdf(bytes)) throw new ApiError(422, 'not_pdf')
  const typed = input.password?.trim() ? input.password.trim() : null
  if (typed && typed.length > MAX_PASSWORD) throw new ApiError(422, 'password_required', { typed: true })

  // One D1 round trip: the household key, members, pending passwords, duplicates, open jobs and quota counters.
  const hash = await contentHash(env, bytes)
  const now = Date.now()
  const user = `user:${t.userId}`
  const [keyRes, memberRes, pendingRes, stateRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db
      .prepare('SELECT id, pan_hmac, pan_enc, pan_masked, display_name_enc FROM member WHERE household_id = ?1 ORDER BY created_at, id')
      .bind(t.householdId),
    db.prepare('SELECT pan_hmac, password_enc FROM pending_statement_password WHERE household_id = ?1 AND expires_at > ?2').bind(t.householdId, now),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM statement WHERE household_id = ?1 AND content_hash = ?2) AS stored,
           (SELECT COUNT(*) FROM parse_job WHERE household_id = ?1 AND content_hash = ?2 AND status IN ('queued','parsing')) AS processing,
           (SELECT COUNT(*) FROM parse_job WHERE household_id = ?1 AND status IN ('queued','parsing')) AS open_jobs,
           (SELECT count FROM quota WHERE subject = ?3 AND metric = 'upload' AND window = ?4) AS day,
           (SELECT count FROM quota WHERE subject = ?3 AND metric = 'upload' AND window = ?5) AS month,
           (SELECT count FROM quota WHERE subject = ?3 AND metric = 'parse_fail' AND window = ?6) AS fails`,
      )
      .bind(t.householdId, hash, user, quotaWindow('day', now), quotaWindow('month', now), quotaWindow('hour', now)),
  ])
  const state = stateRes!.results[0] as { stored: number; processing: number; open_jobs: number; day: number | null; month: number | null; fails: number | null }

  // A1: fair use (§11).
  if ((state.fails ?? 0) >= LIMITS.failedParsesPerHour) throw tooMany('too_many_failures', secondsLeft('hour', now))
  if ((state.day ?? 0) >= LIMITS.uploadsPerDay) throw tooMany('upload_limit', secondsLeft('day', now))
  if ((state.month ?? 0) >= LIMITS.uploadsPerMonth) throw tooMany('upload_limit', secondsLeft('month', now))
  if (state.open_jobs >= LIMITS.openJobsPerHousehold) throw tooMany('jobs_limit', 30)
  // A3: duplicates, stored or still queued.
  if (state.stored) throw new ApiError(409, 'already_added')
  if (state.processing) throw new ApiError(409, 'already_processing')

  const keyRow = keyRes!.results[0] as { dek_wrapped: number[]; kek_version: number } | undefined
  if (!keyRow) throw notFound()
  const vault = await t.vaultFromRow(keyRow)
  const members = memberRes!.results as MemberRow[]

  // A4: candidate passwords, in order: typed, each member's PAN, pending KFintech passwords.
  const candidates = await candidatePasswords(vault, typed, members, pendingRes!.results as PendingRow[])
  const fail = async (status: 422, code: string, extra: Record<string, unknown> = {}) => {
    await takeQuota(env, [failQuota(t.userId)]).catch(() => undefined) // the refusal itself is the 429 next time
    log('upload_failed', code, started)
    return new ApiError(status, code, extra)
  }

  // A5: open, detect the type, find the holder's PAN, count pages.
  const pre = await precheckPdf(bytes, candidates.map((c) => c.password))
  if (!pre.ok) {
    if (pre.code === 'password_required' && !typed) {
      log('upload_needs_password', pre.code, started) // the first statement of a household: not a failure
      throw new ApiError(422, 'password_required', { typed: false })
    }
    throw await fail(422, pre.code, pre.code === 'password_required' ? { typed: true } : {})
  }
  const used = pre.passwordIndex === null ? null : candidates[pre.passwordIndex]!
  let prePan = pre.pan
  if (used?.source === 'pan') {
    // The member's PAN opened it: a strong signal that must agree with the PAN printed in it.
    if (prePan && prePan !== used.pan) throw await fail(422, 'pan_mismatch')
    prePan ??= used.pan!
  }
  const memberByHmac = new Map(members.map((m) => [m.pan_hmac, m]))
  const prePanHmac = prePan ? await panHmac(env, prePan) : null
  if (prePanHmac && !memberByHmac.has(prePanHmac) && members.length >= LIMITS.membersPerHousehold) {
    log('upload_refused', 'member_limit', started)
    throw new ApiError(422, 'member_limit')
  }

  // B: a free slot, or a place in the queue with the parked-PDF counter taken (§10.1 B, D).
  const slot = await engineApi.acquire(env, { cls: 'fast', wait: true, park: bytes.length })
  if (!slot.ok && slot.code === 'full') {
    log('upload_refused', 'queue_full', started) // the global parked-PDF cap (§11): nothing stored
    throw new ApiError(503, 'queue_full', { retry_after: slot.retry_after })
  }
  if (!slot.ok) {
    // D: park it. Everything the user could fix was checked above, so the job never needs them again.
    const job = await parkUpload(t, vault, {
      bytes,
      contentHash: hash,
      kind: pre.kind,
      source: used?.source ?? 'none',
      typedPassword: used?.source === 'typed' ? used.password : null,
      pendingPanHmac: used?.source === 'kfintech_pending' ? used.pendingPanHmac! : null,
      prePanHmac,
      memberId: prePanHmac ? (memberByHmac.get(prePanHmac)?.id ?? null) : null,
      ticket: slot.ticket!,
      queuedAhead: slot.queued_ahead,
      etaS: slot.eta_s,
    })
    console.log('upload_queued', { kind: pre.kind, pages: pre.pages, position: job.position, ms: Date.now() - started, source: used?.source ?? 'none' })
    return { queued: job }
  }

  // C5: parse on the leased slot (released inside, whatever happens).
  const parsed = await engineApi.parse(env, slot, { bytes, password: used?.password ?? '', kind: pre.kind })
  if (!parsed.ok) {
    const code = engineFailure(parsed.code, pre.kind)
    if (code === 'parse_timeout') {
      log('upload_failed', code, started)
      throw new ApiError(504, code)
    }
    throw await fail(422, code)
  }

  // C6 + C7: the member from the parsed PAN, then store.
  const result = await finishParsed(t, vault, members, {
    parsed,
    contentHash: hash,
    prePanHmac,
    pendingPanHmac: used?.source === 'kfintech_pending' ? used.pendingPanHmac! : null,
    audit,
  }).catch(async (err) => {
    // A statement the parser couldn't use counts as a failed upload; a full household doesn't.
    if (err instanceof ApiError && (err.code === 'parse_error' || err.code === 'precheck_disagree')) throw await fail(422, err.code)
    if (err instanceof ApiError) log('upload_refused', err.code, started)
    throw err
  })
  // C8: the debounced rebuild (§10.2).
  await requestRebuild(env, t.householdId)
  console.log('upload_ok', { kind: result.statement.kind, pages: pre.pages, slot: slot.name, ms: Date.now() - started, source: used?.source ?? 'none' })
  return { added: result }
}

/** An engine failure code as the API reports it. Anything unknown is parse_error; precheck_disagree is a bug. */
export function engineFailure(code: string, kind: string): string {
  const out = ENGINE_FAILURES.has(code) ? code : 'parse_error'
  if (out === 'precheck_disagree') console.error('precheck_disagree', kind) // counted in metrics
  return out
}

/**
 * §10.1 C6 + C7, shared by the direct path and the parse consumer: the parsed PAN is authoritative and must agree
 * with the pre-check's; find or create the member (within the cap), then store. Throws ApiError with the code.
 */
export async function finishParsed(
  t: Tenant,
  vault: Vault,
  members: Array<Pick<MemberRow, 'id' | 'pan_hmac' | 'pan_masked' | 'display_name_enc'>>,
  p: Omit<StoreInput, 'pan' | 'panHmac' | 'member'> & { prePanHmac: string | null },
): Promise<AddedStatement> {
  const pan = normalizePan(p.parsed.pan ?? '')
  if (!pan) throw new ApiError(422, 'parse_error')
  const hmac = await panHmac(t.env, pan)
  if (p.prePanHmac && hmac !== p.prePanHmac) {
    console.error('precheck_disagree', 'pan')
    throw new ApiError(422, 'precheck_disagree')
  }
  const existing = members.find((m) => m.pan_hmac === hmac) ?? null
  if (!existing && members.length >= LIMITS.membersPerHousehold) throw new ApiError(422, 'member_limit')
  return storeStatement(t, vault, { ...p, pan, panHmac: hmac, member: existing })
}

async function candidatePasswords(vault: Vault, typed: string | null, members: MemberRow[], pending: PendingRow[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (c: Candidate) => {
    if (!c.password || seen.has(c.password)) return
    seen.add(c.password)
    out.push(c)
  }
  if (typed) {
    add({ password: typed, source: 'typed' })
    const asPan = normalizePan(typed) // "abcde1234f" typed for a CDSL statement
    if (asPan) add({ password: asPan, source: 'typed' })
  }
  for (const m of members.slice(0, LIMITS.membersPerHousehold)) {
    const memberPan = await vault.openText(fieldKey.pan(m.id), m.pan_enc)
    add({ password: memberPan, source: 'pan', pan: memberPan })
  }
  for (const p of pending) {
    add({ password: await vault.openText(fieldKey.pendingPassword(p.pan_hmac), p.password_enc), source: 'kfintech_pending', pendingPanHmac: p.pan_hmac })
  }
  return out
}

const tooMany = (code: string, retryAfter: number) => new ApiError(429, code, { retry_after: retryAfter })

function log(event: string, code: string, started: number) {
  console.log(event, { code, ms: Date.now() - started })
}

// ─── storeStatement (§10.1 C7; shared with the queued path, M8) ─────────────────────────────────────────────────

export type StoreInput = {
  parsed: Extract<EngineParse, { ok: true }>
  contentHash: string
  pan: string
  panHmac: string
  /** The household's member with this PAN, if there is one. Otherwise one is created in the same batch. */
  member: { id: string; pan_masked: string; display_name_enc: Bytes | null } | null
  /** The pending KFintech password that opened the file: deleted with the store. */
  pendingPanHmac: string | null
  audit: D1PreparedStatement
  /** Take the upload quota in the batch (direct path). The queued path took it when the PDF was parked. */
  quota?: boolean
  /** More statements for the same batch, given the new statement's id (the parse job's 'done' update). */
  extra?: (statementId: string) => D1PreparedStatement[]
  now?: number
}

/** The statement's facts the row needs, from the engine's output. Null if the statement is unusable. */
export function statementFacts(parsed: Extract<EngineParse, { ok: true }>) {
  const st: ParsedStatement = parsed.statement
  const kind: StatementKind | null = parsed.kind === 'CDSL' ? 'CDSL' : parsed.source === 'CAMS' || parsed.source === 'KFINTECH' ? parsed.source : null
  const asOf = parsed.kind === 'CDSL' ? st.period_to : (st.valuation_date ?? st.period_to)
  if (!kind || typeof asOf !== 'string' || !ISO_DAY.test(asOf)) return null
  const periodFrom = typeof st.period_from === 'string' && ISO_DAY.test(st.period_from) ? st.period_from : null
  const holdings = Array.isArray(st.holdings) ? st.holdings : []
  const warnings = Array.isArray(st.warnings) ? st.warnings.length : 0
  const name = cleanName(st.holder_name)
  const firstTxn = firstTransactionDates(st.transactions)
  return { kind, asOf, periodFrom, holdings, warnings, name, firstTxn, soldCodes: soldSchemeCodes(st.schemes, holdings, firstTxn) }
}

/** A statement can list this many fully redeemed funds for NAV backfill (one mfapi fetch each, once ever). */
export const MAX_SOLD_BACKFILLS = 100

/**
 * Funds a CAMS/KFintech statement lists but no longer holds (fully redeemed), as AMFI code → earliest transaction date.
 * Their NAV history is still needed: the value chart is rebuilt month by month from every fund held at the time. They
 * get a one-time backfill but are not tracked (no nightly NAVs, stock or AMC fetches for funds nobody holds).
 */
export function soldSchemeCodes(schemes: unknown, holdings: Array<Record<string, unknown>>, firstTxn: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>()
  if (!Array.isArray(schemes)) return out
  const held = new Set(holdings.map((h) => (typeof h.isin === 'string' ? h.isin.toUpperCase() : '')))
  for (const sc of schemes as Array<Record<string, unknown>>) {
    const isin = typeof sc?.isin === 'string' ? sc.isin.toUpperCase() : ''
    const code = Number.parseInt(String(sc?.amfi ?? ''), 10)
    if (!FUND_ISIN.test(isin) || held.has(isin) || !Number.isSafeInteger(code) || code <= 0) continue
    const from = firstTxn.get(isin)
    const prev = out.get(code)
    if (prev === undefined || (from !== undefined && from < prev)) out.set(code, from ?? prev ?? 0)
    if (out.size >= MAX_SOLD_BACKFILLS) break
  }
  return out
}

/** Queue a one-time NAV backfill for codes never backfilled (sold funds). Returns the number queued. */
export async function backfillCodes(env: { MARKET: D1Database; Q_MARKET: Queue }, codes: Map<number, number>, now = Date.now()): Promise<number> {
  if (!codes.size) return 0
  const res = await env.MARKET.prepare(
    `INSERT INTO nav_backfill (amfi_code, status, at) SELECT value, 'pending', ?2 FROM json_each(?1) WHERE true
     ON CONFLICT DO NOTHING RETURNING amfi_code`,
  )
    .bind(JSON.stringify([...codes.keys()]), now)
    .all<{ amfi_code: number }>()
  const queued = res.results.map((r) => r.amfi_code)
  if (queued.length) {
    await marketQueue.sendBatch(env, queued.map((code): MarketMessage => {
      const from = codes.get(code)
      return { type: 'backfill', code, ...(from ? { from } : {}) }
    }))
  }
  return queued.length
}

/** The earliest transaction date per ISIN (YYYYMMDD): how far back a scheme's NAV backfill must reach. */
export function firstTransactionDates(transactions: unknown): Map<string, number> {
  const out = new Map<string, number>()
  if (!Array.isArray(transactions)) return out
  for (const t of transactions as Array<Record<string, unknown>>) {
    const isin = typeof t?.isin === 'string' ? t.isin.toUpperCase() : ''
    const date = typeof t?.date === 'string' && ISO_DAY.test(t.date) ? Number(t.date.replaceAll('-', '')) : 0
    if (isin && date && date < (out.get(isin) ?? Infinity)) out.set(isin, date)
  }
  return out
}

/**
 * Seal the parsed JSON into R2, then in one DB.batch(): create the member if needed (race-safe, within the member
 * cap), insert the statement row, drop the oldest statements of the same kind beyond 24 for the member, delete the
 * pending password that was used, take the upload quota, and write the audit row. Any refusal rolls the whole batch
 * back and the blob is deleted again. Then the public scheme ids go to MARKET.tracked_scheme.
 */
export async function storeStatement(t: Tenant, vault: Vault, s: StoreInput): Promise<AddedStatement> {
  const { env } = t
  const db = env.DB
  const now = s.now ?? Date.now()
  const facts = statementFacts(s.parsed)
  if (!facts) throw new ApiError(422, 'parse_error')

  const id = crypto.randomUUID()
  const key = t.keys.statement(id)
  await putJsonBlob(env, vault, key, { format: 1, kind: facts.kind, parser_version: s.parsed.version, statement: s.parsed.statement })

  const stmts: D1PreparedStatement[] = []
  let newMember: { id: string; name: string | null } | null = null
  if (!s.member) {
    const ins = await memberInsert(t, vault, { pan: s.pan, name: facts.name, now, maxMembers: LIMITS.membersPerHousehold })
    newMember = { id: ins.id, name: facts.name }
    stmts.push(ins.stmt)
  } else if (!s.member.display_name_enc && facts.name) {
    // A member without a name gets the holder's; a rename (or an earlier statement's name) is never overwritten.
    const sealed = await vault.sealText(fieldKey.name(s.member.id), facts.name)
    stmts.push(
      db.prepare('UPDATE member SET display_name_enc = ?1 WHERE id = ?2 AND household_id = ?3 AND display_name_enc IS NULL').bind(sealed, s.member.id, t.householdId),
    )
  }
  const insertAt = stmts.length
  stmts.push(
    db
      .prepare(
        `INSERT INTO statement (id, household_id, member_id, kind, as_of, period_from, blob_key, content_hash, parser_version,
                                holdings_count, warnings_count, created_at)
         VALUES (?1, ?2, (SELECT id FROM member WHERE household_id = ?2 AND pan_hmac = ?3), ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         RETURNING member_id`,
      )
      .bind(id, t.householdId, s.panHmac, facts.kind, facts.asOf, facts.periodFrom, key, s.contentHash, String(s.parsed.version ?? 'unknown'),
        facts.holdings.length, facts.warnings, now),
  )
  // Keep 24 statements per member: past that, the oldest of the kind that just arrived go (§11).
  const trimAt = stmts.length
  stmts.push(
    db
      .prepare(
        `DELETE FROM statement WHERE id IN (
           SELECT s.id FROM statement s JOIN member m ON m.id = s.member_id
           WHERE m.household_id = ?1 AND m.pan_hmac = ?2 AND s.kind = ?3 AND s.id <> ?4
           ORDER BY s.as_of, s.created_at
           LIMIT MAX(0, (SELECT COUNT(*) FROM statement s2 JOIN member m2 ON m2.id = s2.member_id
                         WHERE m2.household_id = ?1 AND m2.pan_hmac = ?2) - ?5))
         RETURNING blob_key`,
      )
      .bind(t.householdId, s.panHmac, facts.kind, id, LIMITS.statementsPerMember),
  )
  if (s.pendingPanHmac) {
    stmts.push(db.prepare('DELETE FROM pending_statement_password WHERE household_id = ?1 AND pan_hmac = ?2').bind(t.householdId, s.pendingPanHmac))
  }
  const quota = s.quota === false ? [] : uploadQuota(t.userId)
  for (const q of quota) stmts.push(quotaStatement(db, q, now))
  stmts.push(s.audit)
  if (s.extra) stmts.push(...s.extra(id))

  let results: D1Result[]
  try {
    results = await db.batch(stmts)
  } catch (err) {
    await env.BUCKET.delete(key).catch(() => undefined)
    const message = err instanceof Error ? err.message : ''
    if (quota.length && isQuotaRefusal(err)) {
      const full = await refusal(env, quota, now)
      throw tooMany('upload_limit', full.retryAfter)
    }
    if (/NOT NULL constraint failed: statement\.member_id/.test(message)) throw new ApiError(422, 'member_limit')
    if (/UNIQUE constraint failed: statement\./.test(message)) throw new ApiError(409, 'already_added')
    throw err
  }

  const memberId = (results[insertAt]?.results[0] as { member_id: string } | undefined)?.member_id
  if (!memberId) throw new StoreError('statement row not returned')
  const trimmed = ((results[trimAt]?.results ?? []) as { blob_key: string }[]).map((r) => r.blob_key)
  if (trimmed.length) await deleteBlobs(env, t.householdId, trimmed).catch((e) => console.error('blob_delete_failed', (e as Error).name, trimmed.length))

  await trackSchemes(env, facts.holdings, now, facts.firstTxn).catch((e) => console.error('tracked_scheme_failed', (e as Error).name))
  await backfillCodes(env, facts.soldCodes, now).catch((e) => console.error('sold_backfill_failed', (e as Error).name))
  // Shares and bonds (M20): tracked for the price job; a new one's history is asked for now.
  await trackEquities(env, equityIsins(facts.holdings), now)
    .then((ask) => sendPrices(env, ask))
    .catch((e) => console.error('tracked_equity_failed', (e as Error).name))

  const created = newMember?.id === memberId
  let name: string | null
  if (created) name = newMember!.name
  else if (s.member?.id === memberId && s.member.display_name_enc) name = await vault.openText(fieldKey.name(memberId), s.member.display_name_enc)
  else name = facts.name // the member had no name and just got the holder's, or a concurrent upload created it
  return {
    statement: { id, kind: facts.kind, as_of: facts.asOf, holdings_count: facts.holdings.length, warnings_count: facts.warnings },
    member: { id: memberId, name, pan_masked: s.member?.pan_masked ?? maskPan(s.pan), created },
  }
}

export class StoreError extends Error {
  override name = 'StoreError'
}

// ─── tracked_scheme (MARKET; public scheme ids only, no link to the user) ───────────────────────────────────────

const ROWS_PER_STATEMENT = 30 // 3 bound values per row + 1: under D1's 100 parameters per statement
const FUND_ISIN = /^INF[0-9A-Z]{9}$/
const SEEN_REFRESH_MS = 86_400_000

export type SchemeRow = { isin: string; amfi_code: number | null; amc: string | null }

/** The mutual-fund schemes in a statement's holdings, deduplicated. CDSL holdings carry no AMFI code. */
export function schemeRows(holdings: Array<Record<string, unknown>>): SchemeRow[] {
  const byIsin = new Map<string, SchemeRow>()
  for (const h of holdings) {
    const isin = typeof h.isin === 'string' ? h.isin.toUpperCase() : ''
    if (!FUND_ISIN.test(isin)) continue
    const code = Number.parseInt(String(h.amfi ?? ''), 10)
    const amc = typeof h.amc === 'string' && h.amc.trim() ? h.amc.trim().slice(0, 120) : null
    const prev = byIsin.get(isin)
    byIsin.set(isin, { isin, amfi_code: Number.isSafeInteger(code) && code > 0 ? code : (prev?.amfi_code ?? null), amc: amc ?? prev?.amc ?? null })
  }
  return [...byIsin.values()]
}

/**
 * Multi-row upsert: one statement per 30 schemes, all in one MARKET batch. Rows that haven't changed and were seen in
 * the last day are skipped by the WHERE, so a busy day doesn't rewrite the same rows. In the same batch (M9): ISINs
 * without a code get theirs from `scheme`, and codes never backfilled are marked pending and sent to nav-backfill
 * once, with the earliest transaction date for its ISINs (a date only). Returns the tracked rows written.
 */
export async function trackSchemes(
  env: { MARKET: D1Database; Q_MARKET: Queue },
  holdings: Array<Record<string, unknown>>,
  now = Date.now(),
  firstTxn: Map<string, number> = new Map(),
): Promise<number> {
  const rows = schemeRows(holdings)
  if (!rows.length) return 0
  const db = env.MARKET
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + ROWS_PER_STATEMENT)
    const values = chunk.map((_, j) => `(?${j * 3 + 2}, ?${j * 3 + 3}, ?${j * 3 + 4}, ?1)`).join(', ')
    stmts.push(
      db.prepare(
        `INSERT INTO tracked_scheme (isin, amfi_code, amc, last_seen_at) VALUES ${values}
         ON CONFLICT (isin) DO UPDATE SET
           amfi_code = COALESCE(excluded.amfi_code, tracked_scheme.amfi_code),
           amc = COALESCE(excluded.amc, tracked_scheme.amc),
           last_seen_at = excluded.last_seen_at
         WHERE excluded.last_seen_at - tracked_scheme.last_seen_at >= ${SEEN_REFRESH_MS}
            OR (excluded.amfi_code IS NOT NULL AND excluded.amfi_code IS NOT tracked_scheme.amfi_code)
            OR (excluded.amc IS NOT NULL AND excluded.amc IS NOT tracked_scheme.amc)`,
      ).bind(now, ...chunk.flatMap((r) => [r.isin, r.amfi_code, r.amc])),
    )
  }
  const isins = rows.map((r) => r.isin)
  const res = await db.batch<{ amfi_code: number; isin?: string }>([
    ...stmts,
    resolveTrackedStatement(db, isins),
    pendingBackfillStatement(db, now, isins),
    db.prepare('SELECT isin, amfi_code FROM tracked_scheme WHERE amfi_code IS NOT NULL AND isin IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(isins)),
  ])
  const pending = new Set((res.at(-2)?.results ?? []).map((r) => r.amfi_code))
  if (pending.size) {
    const from = new Map<number, number>()
    for (const r of res.at(-1)?.results ?? []) {
      const d = firstTxn.get(r.isin!)
      if (pending.has(r.amfi_code) && d && d < (from.get(r.amfi_code) ?? Infinity)) from.set(r.amfi_code, d)
    }
    // A lost send leaves the row pending: nav-ingest sends it again after 6 h.
    await marketQueue.sendBatch(env, [...pending].map((code): MarketMessage => ({ type: 'backfill', code, ...(from.has(code) ? { from: from.get(code) } : {}) })))
  }
  return res.slice(0, stmts.length).reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}

// ─── DELETE /api/statements/:id ─────────────────────────────────────────────────────────────────────────────────

/** Delete one statement (row, then its blob). False if it isn't this household's. */
export async function deleteStatement(t: Tenant, statementId: string, audit: D1PreparedStatement): Promise<boolean> {
  const [del] = await t.env.DB.batch<{ blob_key: string }>([
    t.env.DB.prepare('DELETE FROM statement WHERE id = ?1 AND household_id = ?2 RETURNING blob_key').bind(statementId, t.householdId),
    audit, // onlyIfChanged: no audit row for a 404
  ])
  const keys = (del?.results ?? []).map((r) => r.blob_key)
  if (!keys.length) return false
  await deleteBlobs(t.env, t.householdId, keys).catch((e) => console.error('blob_delete_failed', (e as Error).name, keys.length))
  await requestRebuild(t.env, t.householdId)
  return true
}
