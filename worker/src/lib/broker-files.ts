// Broker files as a source (plan §21.13, D29, M34): a broker's holdings statement or tradebook, CSV or Excel, through
// the same upload as statements. The engine tells the two apart by the header row.
//
// A holdings statement gives each share's quantity and average buy price in one broker account. Only {broker, as_of,
// holdings: [{isin, name, qty, avg_price, close}]} is kept, compressed and sealed like a tradebook; the file never is
// (§0.5, D6). Its preamble's name only suggests the member's name, and its client code only becomes an HMAC that keys
// "same account" (a newer file from the account replaces the older one).
//
// Broker files carry no PAN, so the member is: the one whose PAN the file names; else the one this account's earlier
// file went to; else the one whose name matches the file's; else the user is asked ("Whose is this?", 422
// needs_member) and sends the file again with `member_id` or `new_member_name`. A new member made that way has no PAN
// (members.ts memberInsertNoPan). When a CDSL/CAMS statement later brings a new PAN with a matching name, the members
// list asks "Is this the same person?": yes merges the PAN-less member into it (mergeMembers), no is remembered.
//
// Privacy (§0.1): logs carry the kind, broker slug, counts and durations only. Names, client codes, ISINs and amounts
// never reach a log.
import { blobKeys, deleteBlobs, isUuid, putJsonBlob } from './blob'
import { hmacHex } from './crypto'
import { engineApi } from './engine-client'
import { ApiError, notFound } from './errors'
import { failQuota, LIMITS, uploadQuota } from './limits'
import { cleanName, fieldKey, memberInsertNoPan, normalizePan, sameName } from './members'
import { isQuotaRefusal, quotaStatement, quotaWindow, refusal, secondsLeft, takeQuota } from './quota'
import { requestRebuild } from './snapshot'
import { contentHash, trackSchemes } from './statements'
import type { Tenant } from './tenant'
import { BROKERS as TRADEBOOK_BROKERS, looksLikeTradebook, storeTradebook, stockCostKey, tradebookFacts, type TradebookView } from './tradebooks'
import { sendPrices } from '../market/jobs'
import { equityIsins, trackEquities } from '../market/prices'

/** Brokers whose holdings statements the engine reads (engine/engine/parsers/broker_holdings.py). */
export const HOLDINGS_BROKERS: Record<string, string> = { groww: 'Groww', zerodha: 'Zerodha', dhan: 'Dhan' }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISIN = /^IN[A-Z0-9]{10}$/
const MAX_HOLDINGS = 2000
const MAX_PASSWORD = 128

export type BrokerHoldingView = { id: string; member_id: string; broker: string; broker_name: string; as_of: string; holdings_count: number }
export type BrokerMember = { id: string; name: string | null; pan_masked: string; created: boolean }
export type BrokerUploadResult =
  | { kind: 'HOLDINGS'; holdings: BrokerHoldingView; member: BrokerMember; replaced: boolean }
  | { kind: 'TRADEBOOK'; tradebook: TradebookView; member: BrokerMember }

type MemberRow = { id: string; pan_enc: number[]; pan_masked: string; display_name_enc: number[] | null; no_pan: number }
type Holding = { isin: string; name: string | null; qty: number; avg_price: number | null; close: number | null }

const FAILURES: Record<string, string> = { unrecognised: 'not_broker_file', wrong_password: 'file_locked', parse_error: 'parse_error' }

/** "Same account": the household, broker and client code (or the member, when the file has no code). */
const accountKey = (t: Tenant, broker: string, code: string | null, memberId: string) =>
  hmacHex(t.env.PAN_PEPPER, `broker-account:${t.householdId}|${broker}|${code ? `code:${code}` : `member:${memberId}`}`)

/** The engine's holdings rows, checked and trimmed to what is stored. */
function cleanHoldings(rows: unknown): Holding[] | null {
  if (!Array.isArray(rows)) return null
  const out: Holding[] = []
  const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
  for (const r of rows.slice(0, MAX_HOLDINGS) as Array<Record<string, unknown>>) {
    const isin = typeof r?.isin === 'string' ? r.isin.toUpperCase() : ''
    const qty = pos(r?.qty)
    if (!ISIN.test(isin) || !qty) continue
    out.push({ isin, name: typeof r.name === 'string' ? r.name.slice(0, 120) : null, qty, avg_price: pos(r.avg_price), close: pos(r.close) })
  }
  return out
}

const istToday = (now: number) => new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10)

/**
 * A broker file through POST /api/statements (anything that isn't a PDF). Throws ApiError for every refusal; nothing
 * is stored unless it succeeds. `audit`: the rows for each kind (written in the store's batch).
 */
export async function uploadBrokerFile(
  t: Tenant,
  input: { bytes: Uint8Array<ArrayBuffer>; password: string | null; memberId: unknown; newMemberName: unknown },
  audit: { holdings: D1PreparedStatement; tradebook: D1PreparedStatement },
): Promise<BrokerUploadResult> {
  const { env } = t
  const db = env.DB
  const started = Date.now()
  const { bytes } = input
  if (bytes.length > LIMITS.tradebookBytes) throw new ApiError(413, 'file_too_large')
  if (!looksLikeTradebook(bytes)) throw new ApiError(422, 'not_broker_file')
  const typed = input.password?.trim() || null
  if (typed && typed.length > MAX_PASSWORD) throw new ApiError(422, 'file_locked')
  const chosenId = input.memberId === undefined || input.memberId === null || input.memberId === '' ? null : input.memberId
  if (chosenId !== null && !isUuid(chosenId)) throw notFound()
  const newName = input.newMemberName === undefined || input.newMemberName === null || input.newMemberName === '' ? null : cleanName(input.newMemberName)
  if (input.newMemberName && !newName) throw new ApiError(400, 'invalid_name')

  const hash = await contentHash(env, bytes)
  const now = Date.now()
  const [keyRes, memberRes, stateRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db.prepare('SELECT id, pan_enc, pan_masked, display_name_enc, no_pan FROM member WHERE household_id = ?1 ORDER BY created_at, id').bind(t.householdId),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tradebook WHERE household_id = ?1 AND content_hash = ?2)
              + (SELECT COUNT(*) FROM broker_holding WHERE household_id = ?1 AND content_hash = ?2) AS stored,
                (SELECT count FROM quota WHERE subject = ?3 AND metric = 'parse_fail' AND window = ?4) AS fails`,
      )
      .bind(t.householdId, hash, `user:${t.userId}`, quotaWindow('hour', now)),
  ])
  const keyRow = keyRes!.results[0] as { dek_wrapped: number[]; kek_version: number } | undefined
  if (!keyRow) throw notFound()
  const members = memberRes!.results as MemberRow[]
  const state = stateRes!.results[0] as { stored: number; fails: number | null }
  if ((state.fails ?? 0) >= LIMITS.failedParsesPerHour) throw new ApiError(429, 'too_many_failures', { retry_after: secondsLeft('hour', now) })
  if (state.stored) throw new ApiError(409, 'already_added')
  const chosen = chosenId ? members.find((m) => m.id === chosenId) : undefined
  if (chosenId && !chosen) throw notFound()
  if (newName && members.length >= LIMITS.membersPerHousehold) throw new ApiError(422, 'member_limit')

  const vault = await t.vaultFromRow(keyRow)
  const pans = new Map<string, string>() // member id → PAN, for members that have one
  for (const m of members) {
    if (m.no_pan) continue
    pans.set(m.id, await vault.openText(fieldKey.pan(m.id), m.pan_enc))
  }
  const names = new Map<string, string | null>()
  for (const m of members) names.set(m.id, m.display_name_enc ? await vault.openText(fieldKey.name(m.id), m.display_name_enc) : null)
  // Groww's Excel files open with the holder's PAN: the typed password, the chosen member's, then everyone's.
  const candidates = [...new Set([typed, chosen ? pans.get(chosen.id) : null, ...pans.values()].filter((p): p is string => !!p))]
  const fail = async (code: string) => {
    await takeQuota(env, [failQuota(t.userId)]).catch(() => undefined)
    console.log('broker_file_failed', { code, ms: Date.now() - started })
    return new ApiError(422, code)
  }

  const slot = await engineApi.acquire(env, { cls: 'fast', wait: false })
  if (!slot.ok) {
    console.log('broker_file_busy', { ms: Date.now() - started })
    throw new ApiError(503, 'engine_busy', { retry_after: slot.code === 'busy' ? Math.max(5, Math.min(60, slot.eta_s)) : slot.retry_after })
  }
  const parsed = await engineApi.parse(env, slot, { bytes, password: JSON.stringify(candidates), kind: 'BROKER' })
  if (!parsed.ok) {
    if (parsed.code === 'parse_timeout') throw new ApiError(504, 'parse_timeout')
    if (parsed.code === 'wrong_password') {
      // not the user's mistake yet: they may not have typed one (the first file of a household)
      console.log('broker_file_locked', { typed: !!typed, ms: Date.now() - started })
      if (!typed) throw new ApiError(422, 'file_locked', { typed: false })
    }
    throw await fail(FAILURES[parsed.code] ?? 'parse_error')
  }
  if (parsed.kind !== 'HOLDINGS' && parsed.kind !== 'TRADEBOOK') throw await fail('parse_error')
  const st = parsed.statement as Record<string, unknown>
  const filePan = parsed.pan ? normalizePan(parsed.pan) : null

  // Whose is it?
  let member: MemberRow | undefined = chosen
  let suggested: string | null = null
  if (member) {
    const pan = pans.get(member.id)
    if (filePan && pan && filePan !== pan) throw await fail('pan_mismatch')
  } else if (!newName) {
    member = filePan ? members.find((m) => pans.get(m.id) === filePan) : undefined
    const holder = parsed.kind === 'HOLDINGS' ? cleanName(st.holder_name) : null
    if (!member && parsed.kind === 'HOLDINGS') {
      const broker = String(st.broker ?? '')
      const code = typeof st.client_code === 'string' ? st.client_code : null
      if (code) {
        // the member this account's earlier file went to (keyed with the code, so any member's key matches)
        const key = await accountKey(t, broker, code, '')
        const row = await db.prepare('SELECT member_id FROM broker_holding WHERE household_id = ?1 AND account_key = ?2').bind(t.householdId, key).first<{ member_id: string }>()
        member = row ? members.find((m) => m.id === row.member_id) : undefined
      }
    }
    if (!member && holder) {
      const matches = members.filter((m) => sameName(names.get(m.id), holder))
      if (matches.length === 1) member = matches[0]
    }
    if (!member) {
      suggested = holder
      console.log('broker_file_needs_member', { kind: parsed.kind, ms: Date.now() - started })
      const brokerName = String((parsed.kind === 'HOLDINGS' ? HOLDINGS_BROKERS : TRADEBOOK_BROKERS)[String(st.broker)] ?? '')
      throw new ApiError(422, 'needs_member', { kind: parsed.kind, broker_name: brokerName, suggested_name: suggested })
    }
  }

  // A new member (no PAN), inserted in the store's batch.
  let created: { id: string; stmt: D1PreparedStatement } | null = null
  if (!member && newName) created = await memberInsertNoPan(t, vault, { name: newName, now, maxMembers: LIMITS.membersPerHousehold })
  const memberId = member?.id ?? created!.id
  const memberView: BrokerMember = {
    id: memberId,
    name: created ? newName : (names.get(memberId) ?? null),
    pan_masked: member?.pan_masked ?? '',
    created: !!created,
  }

  if (parsed.kind === 'TRADEBOOK') {
    const facts = tradebookFacts(parsed)
    if (typeof facts === 'string') throw await fail(facts)
    const count = await db.prepare('SELECT COUNT(*) AS n FROM tradebook WHERE member_id = ?1').bind(memberId).first<{ n: number }>()
    if ((count?.n ?? 0) >= LIMITS.tradebooksPerMember) throw new ApiError(422, 'tradebook_limit')
    const tradebook = await storeTradebook(t, vault, { memberId, facts, contentHash: hash, version: parsed.version, audit: audit.tradebook, now, before: created ? [created.stmt] : [] })
    console.log('broker_file_ok', { kind: 'TRADEBOOK', broker: facts.broker, trades: facts.trades.length, slot: slot.name, ms: Date.now() - started })
    return { kind: 'TRADEBOOK', tradebook, member: memberView }
  }

  // A holdings statement.
  const broker = typeof st.broker === 'string' && HOLDINGS_BROKERS[st.broker] ? st.broker : null
  const holdings = cleanHoldings(st.holdings)
  if (!broker || !holdings) throw await fail('parse_error')
  if (!holdings.length) throw await fail('no_holdings')
  const asOf = typeof st.as_of === 'string' && ISO_DAY.test(st.as_of) && st.as_of <= istToday(now) ? st.as_of : istToday(now)
  const code = typeof st.client_code === 'string' && st.client_code ? st.client_code : null
  const account = await accountKey(t, broker, code, code ? '' : memberId)
  const [prevRes, countRes] = await db.batch([
    db.prepare('SELECT id, as_of, blob_key FROM broker_holding WHERE household_id = ?1 AND account_key = ?2').bind(t.householdId, account),
    db.prepare('SELECT COUNT(*) AS n FROM broker_holding WHERE member_id = ?1').bind(memberId),
  ])
  const prev = prevRes!.results[0] as { id: string; as_of: string; blob_key: string } | undefined
  if (prev && prev.as_of > asOf) throw new ApiError(409, 'older_file', { as_of: prev.as_of })
  if (!prev && ((countRes!.results[0] as { n: number }).n ?? 0) >= LIMITS.brokerHoldingsPerMember) throw new ApiError(422, 'broker_file_limit')

  const id = crypto.randomUUID()
  const key = blobKeys.holdings(t.householdId, id)
  await putJsonBlob(env, vault, key, { broker, as_of: asOf, holdings, counts: st.counts ?? {} })
  try {
    await db.batch([
      ...(created ? [created.stmt] : []),
      ...uploadQuota(t.userId).map((q) => quotaStatement(db, q, now)),
      ...(prev ? [db.prepare('DELETE FROM broker_holding WHERE id = ?1 AND household_id = ?2').bind(prev.id, t.householdId)] : []),
      db
        .prepare(
          `INSERT INTO broker_holding (id, household_id, member_id, broker, account_key, as_of, holdings_count, blob_key, content_hash, parser_version, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(id, t.householdId, memberId, broker, account, asOf, holdings.length, key, hash, parsed.version ?? '', now),
      audit.holdings,
    ])
  } catch (err) {
    await deleteBlobs(env, t.householdId, [key]).catch(() => undefined)
    const message = (err as Error).message
    if (isQuotaRefusal(err)) {
      const r = await refusal(env, uploadQuota(t.userId), now)
      throw new ApiError(429, 'upload_limit', { retry_after: r.retryAfter })
    }
    if (/UNIQUE constraint failed: broker_holding\.household_id, broker_holding\.content_hash/.test(message)) throw new ApiError(409, 'already_added')
    if (/UNIQUE constraint failed/.test(message)) throw new ApiError(409, 'already_processing') // the same account, at the same moment
    if (/FOREIGN KEY constraint failed/.test(message)) throw new ApiError(422, 'member_limit')
    throw err
  }
  if (prev) await deleteBlobs(env, t.householdId, [prev.blob_key]).catch((e) => console.error('blob_delete_failed', (e as Error).name, 1))
  // Shares (exchange prices, M20) and ETFs (their AMFI code, M9) are tracked like a statement's.
  await trackEquities(env, equityIsins(holdings), now)
    .then((ask) => sendPrices(env, ask))
    .catch((e) => console.error('tracked_equity_failed', (e as Error).name))
  await trackSchemes(env, holdings, now).catch((e) => console.error('tracked_scheme_failed', (e as Error).name))
  await requestRebuild(env, t.householdId)
  console.log('broker_file_ok', { kind: 'HOLDINGS', broker, holdings: holdings.length, replaced: !!prev, slot: slot.name, ms: Date.now() - started })
  return {
    kind: 'HOLDINGS',
    holdings: { id, member_id: memberId, broker, broker_name: HOLDINGS_BROKERS[broker]!, as_of: asOf, holdings_count: holdings.length },
    member: memberView,
    replaced: !!prev,
  }
}

/** Every holdings statement of the household (newest first). */
export async function listBrokerHoldings(t: Tenant): Promise<BrokerHoldingView[]> {
  const res = await t.env.DB.prepare(
    'SELECT id, member_id, broker, as_of, holdings_count FROM broker_holding WHERE household_id = ?1 ORDER BY as_of DESC, created_at DESC',
  )
    .bind(t.householdId)
    .all<Omit<BrokerHoldingView, 'broker_name'>>()
  return res.results.map((r) => ({ ...r, broker_name: HOLDINGS_BROKERS[r.broker] ?? r.broker }))
}

/** Delete one holdings statement (row first, then its blob). False if it isn't this household's. */
export async function deleteBrokerHolding(t: Tenant, id: string, audit: D1PreparedStatement): Promise<boolean> {
  if (!isUuid(id)) return false
  const db = t.env.DB
  const [rows, del] = await db.batch<{ blob_key: string }>([
    db.prepare('SELECT blob_key FROM broker_holding WHERE id = ?1 AND household_id = ?2').bind(id, t.householdId),
    db.prepare('DELETE FROM broker_holding WHERE id = ?1 AND household_id = ?2').bind(id, t.householdId),
    audit,
  ])
  if (!(del!.meta.changes ?? 0)) return false
  const keys = rows!.results.map((r) => r.blob_key)
  await deleteBlobs(t.env, t.householdId, keys).catch((e) => console.error('blob_delete_failed', (e as Error).name, keys.length))
  await requestRebuild(t.env, t.householdId)
  return true
}

// ─── "Is this the same person?" (D29) ───────────────────────────────────────────────────────────────────────────

type PairRow = { id: string; no_pan: number }

async function pair(t: Tenant, fromRaw: unknown, intoRaw: unknown): Promise<{ from: string; into: string }> {
  if (!isUuid(fromRaw) || !isUuid(intoRaw) || fromRaw === intoRaw) throw notFound()
  const res = await t.env.DB.prepare('SELECT id, no_pan FROM member WHERE household_id = ?1 AND id IN (?2, ?3)').bind(t.householdId, fromRaw, intoRaw).all<PairRow>()
  const from = res.results.find((r) => r.id === fromRaw)
  const into = res.results.find((r) => r.id === intoRaw)
  if (!from || !into) throw notFound()
  // Only a member without a PAN merges, and only into one with a PAN: two PANs are two people.
  if (from.no_pan !== 1 || into.no_pan === 1) throw new ApiError(422, 'not_mergeable')
  return { from: from.id, into: into.id }
}

/**
 * Yes: the PAN-less member's broker files, tradebooks, buy prices and manual assets move to the PAN member, and the
 * PAN-less member is deleted. One batch, so it either all happens or nothing does. A buy price both have for the same
 * share keeps the PAN member's.
 */
export async function mergeMembers(t: Tenant, fromRaw: unknown, intoRaw: unknown, audit: D1PreparedStatement): Promise<void> {
  const { from, into } = await pair(t, fromRaw, intoRaw)
  const db = t.env.DB
  const hid = t.householdId
  const costs = await db.prepare('SELECT id, cost_enc FROM stock_cost WHERE household_id = ?1 AND member_id = ?2').bind(hid, from).all<{ id: string; cost_enc: number[] }>()
  const vault = await t.vault()
  const stmts: D1PreparedStatement[] = []
  for (const c of costs.results) {
    const { isin } = JSON.parse(await vault.openText(stockCostKey(c.id), c.cost_enc)) as { isin: string }
    const key = await hmacHex(t.env.PAN_PEPPER, `stockcost:${hid}|${into}|${isin}`) // tradebooks.ts isinKey
    stmts.push(
      db.prepare('DELETE FROM stock_cost WHERE id = ?1 AND household_id = ?2 AND EXISTS (SELECT 1 FROM stock_cost WHERE household_id = ?2 AND isin_key = ?3)').bind(c.id, hid, key),
      db.prepare('UPDATE stock_cost SET member_id = ?1, isin_key = ?2 WHERE id = ?3 AND household_id = ?4').bind(into, key, c.id, hid),
    )
  }
  for (const table of ['broker_holding', 'tradebook', 'manual_asset', 'sip_override', 'parse_job']) {
    stmts.push(db.prepare(`UPDATE ${table} SET member_id = ?1 WHERE member_id = ?2 AND household_id = ?3`).bind(into, from, hid))
  }
  stmts.push(db.prepare('DELETE FROM member WHERE id = ?1 AND household_id = ?2 AND no_pan = 1').bind(from, hid), audit)
  await db.batch(stmts)
  await requestRebuild(t.env, hid)
}

/** No: remember it, so the question isn't asked again for this pair. */
export async function keepSeparate(t: Tenant, fromRaw: unknown, intoRaw: unknown): Promise<void> {
  const { from, into } = await pair(t, fromRaw, intoRaw)
  await t.env.DB.prepare('INSERT INTO member_distinct (household_id, member_a, member_b) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING').bind(t.householdId, from, into).run()
}
