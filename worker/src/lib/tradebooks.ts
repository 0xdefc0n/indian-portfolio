// Broker tradebooks and manual average buy prices (plan §21.6, M21).
//
// A tradebook (CSV or Excel) is parsed in memory on a free EngineFast slot and only its trades are kept, compressed
// and sealed in R2 like a statement. The file is never kept (§0.5, D6). Unlike a PDF it isn't parked for the queue:
// a tradebook is small and rare, and needs only the member's PAN (Groww's reports open with it), so a busy engine
// answers 503 `engine_busy` with retry_after and the SPA tries again by itself (admission control, §0.7).
// The member is picked by the user (tradebooks rarely carry a PAN); when one does, it must match the member's.
//
// Privacy (§0.1): logs carry the broker slug, counts and durations only. Trades, symbols and amounts never reach a log.
import { blobKeys, deleteBlobs, isUuid, putJsonBlob } from './blob'
import { hmacHex, type Vault } from './crypto'
import { engineApi } from './engine-client'
import { ApiError, notFound } from './errors'
import { failQuota, LIMITS, uploadQuota } from './limits'
import { fieldKey, normalizePan } from './members'
import { isQuotaRefusal, quotaStatement, quotaWindow, refusal, secondsLeft, takeQuota } from './quota'
import { requestRebuild } from './snapshot'
import { contentHash } from './statements'
import type { Tenant } from './tenant'

export const BROKERS: Record<string, string> = {
  zerodha: 'Zerodha',
  groww: 'Groww',
  angel_one: 'Angel One',
  upstox: 'Upstox',
  icici_direct: 'ICICI Direct',
  paytm_money: 'Paytm Money',
  dhan: 'Dhan',
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** Excel (zip or OLE, also encrypted) or delimited text; never a PDF. The engine has the same check. */
export function looksLikeTradebook(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return false
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return true
  if (OLE.every((b, i) => bytes[i] === b)) return true
  const head = bytes.subarray(0, 4096)
  if (head.includes(0)) return false
  return head.includes(0x2c) || head.includes(0x09) || head.includes(0x3b) // , \t ;
}

export type TradebookView = { id: string; broker: string; broker_name: string; period_from: string | null; period_to: string | null; trades_count: number }

/** Engine failures for a tradebook, as the API reports them. */
const FAILURES: Record<string, string> = { unrecognised: 'not_tradebook', wrong_password: 'tradebook_locked', parse_error: 'parse_error' }

/** POST /api/tradebooks: parse, check, store. Throws ApiError for every refusal; nothing is stored unless it succeeds. */
export async function uploadTradebook(t: Tenant, memberId: unknown, bytes: Uint8Array<ArrayBuffer>, audit: D1PreparedStatement): Promise<TradebookView> {
  const { env } = t
  const db = env.DB
  const started = Date.now()
  if (bytes.length > LIMITS.tradebookBytes) throw new ApiError(413, 'file_too_large')
  if (!looksLikeTradebook(bytes)) throw new ApiError(422, 'not_tradebook')
  if (!isUuid(memberId)) throw notFound()

  const hash = await contentHash(env, bytes)
  const now = Date.now()
  const user = `user:${t.userId}`
  const [keyRes, memberRes, stateRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version FROM household WHERE id = ?1').bind(t.householdId),
    db.prepare('SELECT id, pan_enc FROM member WHERE id = ?1 AND household_id = ?2').bind(memberId, t.householdId),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tradebook WHERE household_id = ?1 AND content_hash = ?2) AS stored,
                (SELECT COUNT(*) FROM tradebook WHERE member_id = ?3) AS member_count,
                (SELECT count FROM quota WHERE subject = ?4 AND metric = 'parse_fail' AND window = ?5) AS fails`,
      )
      .bind(t.householdId, hash, memberId, user, quotaWindow('hour', now)),
  ])
  const member = memberRes!.results[0] as { id: string; pan_enc: number[] } | undefined
  const keyRow = keyRes!.results[0] as { dek_wrapped: number[]; kek_version: number } | undefined
  if (!member || !keyRow) throw notFound()
  const state = stateRes!.results[0] as { stored: number; member_count: number; fails: number | null }
  if ((state.fails ?? 0) >= LIMITS.failedParsesPerHour) throw new ApiError(429, 'too_many_failures', { retry_after: secondsLeft('hour', now) })
  if (state.stored) throw new ApiError(409, 'already_added')
  if (state.member_count >= LIMITS.tradebooksPerMember) throw new ApiError(422, 'tradebook_limit')

  const vault = await t.vaultFromRow(keyRow)
  const pan = await vault.openText(fieldKey.pan(member.id), member.pan_enc)
  const fail = async (code: string) => {
    await takeQuota(env, [failQuota(t.userId)]).catch(() => undefined)
    console.log('tradebook_failed', { code, ms: Date.now() - started })
    return new ApiError(422, code)
  }

  const slot = await engineApi.acquire(env, { cls: 'fast', wait: false })
  if (!slot.ok) {
    console.log('tradebook_busy', { ms: Date.now() - started })
    throw new ApiError(503, 'engine_busy', { retry_after: slot.code === 'busy' ? Math.max(5, Math.min(60, slot.eta_s)) : slot.retry_after })
  }
  const parsed = await engineApi.parse(env, slot, { bytes, password: pan, kind: 'TRADEBOOK' })
  if (!parsed.ok) {
    if (parsed.code === 'parse_timeout') throw new ApiError(504, 'parse_timeout')
    throw await fail(FAILURES[parsed.code] ?? 'parse_error')
  }
  if (parsed.kind !== 'TRADEBOOK') throw await fail('parse_error')
  const checked = tradebookFacts(parsed)
  if (typeof checked === 'string') throw await fail(checked)
  const filePan = parsed.pan ? normalizePan(parsed.pan) : null
  if (filePan && pan && filePan !== pan) throw await fail('pan_mismatch')
  const view = await storeTradebook(t, vault, { memberId: member.id, facts: checked, contentHash: hash, version: parsed.version, audit, now })
  console.log('tradebook_ok', { broker: view.broker, trades: view.trades_count, slot: slot.name, ms: Date.now() - started })
  return view
}

type TradebookFacts = { broker: string; trades: unknown[]; counts: Record<string, number>; period_from: string | null; period_to: string | null }

/** A parsed tradebook's facts, or the refusal code (parse_error, no_trades). */
export function tradebookFacts(parsed: { statement: unknown }): TradebookFacts | string {
  const st = parsed.statement as { broker?: string; period_from?: string | null; period_to?: string | null; trades?: unknown[]; counts?: Record<string, number> }
  const broker = typeof st.broker === 'string' && BROKERS[st.broker] ? st.broker : null
  if (!broker || !Array.isArray(st.trades)) return 'parse_error'
  if (!st.trades.length) return 'no_trades'
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return { broker, trades: st.trades, counts: st.counts ?? {}, period_from: day(st.period_from), period_to: day(st.period_to) }
}

/**
 * Seal the trades and insert the row, with the upload quota and the audit row, in one batch (M21; shared with the
 * broker-file upload, M34). `before`: statements that must run first in the batch (a new member's insert).
 */
export async function storeTradebook(
  t: Tenant,
  vault: Vault,
  s: { memberId: string; facts: TradebookFacts; contentHash: string; version?: string; audit: D1PreparedStatement; now: number; before?: D1PreparedStatement[] },
): Promise<TradebookView> {
  const { env } = t
  const db = env.DB
  const { broker, trades } = s.facts
  const id = crypto.randomUUID()
  const key = blobKeys.tradebook(t.householdId, id)
  await putJsonBlob(env, vault, key, { broker, trades, counts: s.facts.counts })
  try {
    await db.batch([
      ...(s.before ?? []),
      ...uploadQuota(t.userId).map((q) => quotaStatement(db, q, s.now)),
      db
        .prepare(
          `INSERT INTO tradebook (id, household_id, member_id, broker, period_from, period_to, trades_count, blob_key, content_hash, parser_version, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(id, t.householdId, s.memberId, broker, s.facts.period_from, s.facts.period_to, trades.length, key, s.contentHash, s.version ?? '', s.now),
      s.audit,
    ])
  } catch (err) {
    await deleteBlobs(env, t.householdId, [key]).catch(() => undefined)
    if (isQuotaRefusal(err)) {
      const r = await refusal(env, uploadQuota(t.userId), s.now)
      throw new ApiError(429, 'upload_limit', { retry_after: r.retryAfter })
    }
    if (/UNIQUE constraint failed/.test((err as Error).message)) throw new ApiError(409, 'already_added')
    if (/FOREIGN KEY constraint failed/.test((err as Error).message)) throw new ApiError(422, 'member_limit') // a new member over the cap
    throw err
  }
  await requestRebuild(env, t.householdId)
  return { id, broker, broker_name: BROKERS[broker]!, period_from: s.facts.period_from, period_to: s.facts.period_to, trades_count: trades.length }
}

/** Every tradebook of the household, by member (newest first). */
export async function listTradebooks(t: Tenant): Promise<(TradebookView & { member_id: string })[]> {
  const res = await t.env.DB.prepare(
    'SELECT id, member_id, broker, period_from, period_to, trades_count FROM tradebook WHERE household_id = ?1 ORDER BY created_at DESC',
  )
    .bind(t.householdId)
    .all<TradebookView & { member_id: string }>()
  return res.results.map((r) => ({ ...r, broker_name: BROKERS[r.broker] ?? r.broker }))
}

/** Delete one tradebook (row first, then its blob). False if it isn't this household's. */
export async function deleteTradebook(t: Tenant, id: string, audit: D1PreparedStatement): Promise<boolean> {
  if (!isUuid(id)) return false
  const db = t.env.DB
  const [rows, del] = await db.batch<{ blob_key: string }>([
    db.prepare('SELECT blob_key FROM tradebook WHERE id = ?1 AND household_id = ?2').bind(id, t.householdId),
    db.prepare('DELETE FROM tradebook WHERE id = ?1 AND household_id = ?2').bind(id, t.householdId),
    audit,
  ])
  if (!(del!.meta.changes ?? 0)) return false
  const keys = rows!.results.map((r) => r.blob_key)
  await deleteBlobs(t.env, t.householdId, keys).catch((e) => console.error('blob_delete_failed', (e as Error).name, keys.length))
  await requestRebuild(t.env, t.householdId)
  return true
}

// ─── Manual average buy prices ──────────────────────────────────────────────────────────────────────────────────

export const stockCostKey = (id: string) => `stockcost/${id}`
const STOCK_ISIN = /^IN[EF9][A-Z0-9]{9}$/
const isinKey = (t: Tenant, memberId: string, isin: string) => hmacHex(t.env.PAN_PEPPER, `stockcost:${t.householdId}|${memberId}|${isin}`)

export type StockCost = { member_id: string; isin: string; avg_price: number; since: string | null }

/** The body of PUT /api/stocks/cost, or a 400. Price per share in ₹ (> 0, ≤ ₹10 lakh); since "YYYY-MM" (optional, not in the future). */
export function parseStockCost(body: unknown, now = Date.now()): StockCost {
  const b = (body ?? {}) as Record<string, unknown>
  const isin = typeof b.isin === 'string' ? b.isin.trim().toUpperCase() : ''
  const price = typeof b.avg_price === 'number' ? b.avg_price : Number.NaN
  const since = b.since === undefined || b.since === null || b.since === '' ? null : typeof b.since === 'string' ? b.since : undefined
  const thisMonth = new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 7)
  if (typeof b.member_id !== 'string' || !STOCK_ISIN.test(isin) || !(price > 0 && price <= 1_000_000) || since === undefined) {
    throw new ApiError(400, 'bad_request')
  }
  if (since !== null && (!/^(19[89]\d|20\d\d)-(0[1-9]|1[0-2])$/.test(since) || since > thisMonth)) throw new ApiError(400, 'bad_since')
  return { member_id: b.member_id, isin, avg_price: Math.round(price * 10_000) / 10_000, since }
}

/** Set (or replace) one share's manual average buy price. */
export async function setStockCost(t: Tenant, cost: StockCost, audit: D1PreparedStatement, now = Date.now()): Promise<StockCost> {
  const memberId = await t.assertMember(cost.member_id)
  const key = await isinKey(t, memberId, cost.isin)
  const db = t.env.DB
  const existing = await db.prepare('SELECT id FROM stock_cost WHERE household_id = ?1 AND isin_key = ?2').bind(t.householdId, key).first<{ id: string }>()
  const id = existing?.id ?? crypto.randomUUID()
  const vault = await t.vault()
  const sealed = await vault.sealText(stockCostKey(id), JSON.stringify({ isin: cost.isin, avg_price: cost.avg_price, since: cost.since }))
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO stock_cost (id, household_id, member_id, isin_key, cost_enc, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ?7 = 1 OR (SELECT COUNT(*) FROM stock_cost WHERE household_id = ?2) < ?8
         ON CONFLICT (household_id, isin_key) DO UPDATE SET cost_enc = excluded.cost_enc, updated_at = excluded.updated_at`,
      )
      .bind(id, t.householdId, memberId, key, sealed, now, existing ? 1 : 0, LIMITS.stockCostsPerHousehold),
    audit,
  ])
  if (!(res[0]!.meta.changes ?? 0)) throw new ApiError(422, 'stock_cost_limit')
  await requestRebuild(t.env, t.householdId)
  return { ...cost, member_id: memberId }
}

/** Remove one share's manual price. False if there was none. */
export async function deleteStockCost(t: Tenant, memberIdRaw: unknown, isinRaw: unknown, audit: D1PreparedStatement): Promise<boolean> {
  const memberId = await t.assertMember(memberIdRaw)
  const isin = typeof isinRaw === 'string' ? isinRaw.trim().toUpperCase() : ''
  if (!STOCK_ISIN.test(isin)) throw new ApiError(400, 'bad_request')
  const key = await isinKey(t, memberId, isin)
  const [res] = await t.env.DB.batch([
    t.env.DB.prepare('DELETE FROM stock_cost WHERE household_id = ?1 AND isin_key = ?2').bind(t.householdId, key),
    audit,
  ])
  const gone = (res!.meta.changes ?? 0) > 0
  if (gone) await requestRebuild(t.env, t.householdId)
  return gone
}

/** Every manual price of the household, opened (for the SPA's forms, the build and the export). */
export async function listStockCosts(t: Tenant, rows?: { id: string; member_id: string; cost_enc: number[] }[]): Promise<StockCost[]> {
  const list =
    rows ??
    (await t.env.DB.prepare('SELECT id, member_id, cost_enc FROM stock_cost WHERE household_id = ?1').bind(t.householdId).all<{ id: string; member_id: string; cost_enc: number[] }>())
      .results
  if (!list.length) return []
  const vault = await t.vault()
  return Promise.all(
    list.map(async (r) => {
      const c = JSON.parse(await vault.openText(stockCostKey(r.id), r.cost_enc)) as Omit<StockCost, 'member_id'>
      return { member_id: r.member_id, isin: c.isin, avg_price: c.avg_price, since: c.since ?? null }
    }),
  )
}

