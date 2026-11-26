// Snapshots: the household's built portfolio (plan §10.2, §10.3 prebuild, M10).
//
// Every change that affects the dashboard (an upload, a queued job finishing, a statement or member delete, a rename,
// a stale read, the nightly prebuild) calls requestRebuild(): it stamps snapshot.requested_at and sends a pf-rebuild
// message delayed 10 s, so a family adding 4 statements in a few seconds gets one build.
//
// The pf-rebuild consumer is idempotent and single-flight per household:
//   1. read the inputs (statements, member names, the market day) and hash them; stop if the snapshot already has them;
//   2. lease an EngineBatch slot (no slot: send the message again later, keeping its ticket);
//   3. claim the build with one conditional UPDATE (another consumer building the same inputs → stop);
//   4. decrypt the statements, build on the engine (the answer is the gzip snapshot itself), seal it under a new key;
//   5. compare-and-set the pointer: only the latest claim wins, so an older build never replaces a newer one;
//   6. delete the previous blob; if anything was requested while building, ask again.
// The lease is taken before the claim (the plan has them the other way round), so a build waiting for a slot never
// holds the claim and a waiting message costs no D1 writes.
//
// Snapshot blobs are gzip JSON, sealed with the household DEK (flags: gzip). GET /api/portfolio sends the gzip bytes
// as they are, so the Worker never parses a snapshot.
//
// Privacy (§0.1): logs carry the household id's outcome, counts and durations only.
import { marketStatus, type MarketStatus } from '../routes/market'
import { istToday, ymdToIso } from '../market/amfi'
import { BENCHMARK_CODE } from '../market/store'
import { blobKeys, deleteBlobs, getJsonBlob, isUuid } from './blob'
import { FLAG_GZIP, hmacHex, toBytes, type Vault } from './crypto'
import { engineApi } from './engine-client'
import { waitDelay } from './jobs'
import { cleanName, fieldKey } from './members'
import { Tenant } from './tenant'

/** Bump to rebuild every snapshot (a change in what the Worker sends to /build). */
export const SNAPSHOT_VERSION = 1
/** Debounce: every trigger's message arrives this much later (§10.2). */
export const REBUILD_DELAY_S = 10
/** A claim outlives the engine call (100 s) and matches the batch lease (120 s). */
export const CLAIM_MS = 120_000
/** A stale read asks again only if nothing was asked in this long (or the last ask was already handled). */
export const LAZY_REPEAT_MS = 10 * 60_000
/** After a failed build, a stale read waits this long before asking again. */
export const FAILED_BACKOFF_MS = 10 * 60_000
/** While a held fund's NAV history is still being backfilled, build again this often, at most MAX_FOLLOWUPS times. */
export const FOLLOWUP_DELAY_S = 120
export const MAX_FOLLOWUPS = 10
/** Builds that fail (engine crash, NAV store down) are tried this often in all. */
export const MAX_BUILD_ATTEMPTS = 3
/** snapshot-prebuild covers households active in the last 7 days (§10.3), spreading their builds over 30 min. */
export const PREBUILD_ACTIVE_MS = 7 * 86_400_000
export const PREBUILD_SPREAD_S = 1_800
const PREBUILD_PAGE = 1_000
/** The prebuild fallback, at the latest (wrangler.jsonc; also fires with the stocks cron's days, dispatched apart). */
export const PREBUILD_CRON = '0 5 * * *'

export type RebuildMessage = {
  household_id: string
  /** EnginePool ticket from an earlier wait, so the message keeps its place. */
  ticket?: number
  /** Build even if the inputs hash matches (a backfill finished meanwhile). */
  force?: boolean
  followups?: number
  attempts?: number
}

/** pf-rebuild sends, through one object so tests can capture them instead of the real queue. */
export const rebuildQueue = {
  async send(env: { Q_REBUILD: Queue }, msg: RebuildMessage, delaySeconds = REBUILD_DELAY_S): Promise<void> {
    await env.Q_REBUILD.send(msg, delaySeconds > 0 ? { delaySeconds } : undefined)
  },
  async sendBatch(env: { Q_REBUILD: Queue }, msgs: { body: RebuildMessage; delaySeconds?: number }[]): Promise<void> {
    for (let i = 0; i < msgs.length; i += 100) await env.Q_REBUILD.sendBatch(msgs.slice(i, i + 100))
  },
}

/**
 * Ask for a debounced rebuild of the household's snapshot. Never throws: the change itself already succeeded, and a
 * lost request is caught by the next stale read (or the consumer's own recheck).
 */
export async function requestRebuild(env: { DB: D1Database; Q_REBUILD: Queue }, householdId: string, now = Date.now()): Promise<void> {
  try {
    await env.DB.prepare('UPDATE snapshot SET requested_at = ?1 WHERE household_id = ?2').bind(now, householdId).run()
    await rebuildQueue.send(env, { household_id: householdId })
  } catch (err) {
    console.error('rebuild_request_failed', (err as Error).name)
  }
}

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────────────────────────

type StatementRow = { id: string; member_id: string; kind: 'CDSL' | 'CAMS' | 'KFINTECH'; as_of: string; created_at: number; blob_key: string }
type MemberRow = { id: string; display_name_enc: number[] | null }
export type SnapshotRow = {
  blob_key: string | null
  inputs_hash: string | null
  market_date: string | null
  status: 'ready' | 'building' | 'failed'
  building_hash: string | null
  building_until: number | null
  built_at: number | null
  requested_at: number | null
  checked_at: number | null
  failed_at: number | null
}
const SNAPSHOT_COLUMNS = 'blob_key, inputs_hash, market_date, status, building_hash, building_until, built_at, requested_at, checked_at, failed_at'

/**
 * The statements a build uses: every CDSL statement (their month-end histories are joined) and each member's newest
 * CAMS/KFintech statement. The engine would pick the same ones (engine/engine/portfolio.py _latest_by_member).
 */
export function usedStatements(rows: StatementRow[]): StatementRow[] {
  const rta = new Map<string, StatementRow>()
  const out: StatementRow[] = []
  for (const r of rows) {
    if (r.kind === 'CDSL') {
      out.push(r)
      continue
    }
    const cur = rta.get(r.member_id)
    if (!cur || r.as_of > cur.as_of || (r.as_of === cur.as_of && r.created_at > cur.created_at)) rta.set(r.member_id, r)
  }
  return [...out, ...rta.values()].sort((a, b) => a.member_id.localeCompare(b.member_id) || a.as_of.localeCompare(b.as_of) || a.id.localeCompare(b.id))
}

export type MarketInputs = { marketDate: string; navKey: string }

/** The market day a build uses, and the key the engine caches NAV series by (it changes as the night's rows land). */
export function marketInputs(status: MarketStatus, now = Date.now()): MarketInputs {
  const marketDate = status.latest_nav_date ?? ymdToIso(istToday(now))
  return { marketDate, navKey: `${marketDate}|${status.final ? 1 : 0}|${status.coverage_pct ?? ''}` }
}

const hex = (b: ArrayLike<number> | null) => (b ? Array.from(toBytes(b), (x) => x.toString(16).padStart(2, '0')).join('') : '')

/**
 * What the snapshot depends on, as an opaque 32-hex HMAC: the statements used, each member's (sealed) name, the market
 * day and SNAPSHOT_VERSION. Keyed with PAN_PEPPER, so it reveals nothing.
 */
export async function inputsHash(env: { PAN_PEPPER: string }, market: MarketInputs, statements: StatementRow[], members: MemberRow[]): Promise<string> {
  const doc = JSON.stringify({
    v: SNAPSHOT_VERSION,
    nav: market.navKey,
    s: statements.map((s) => s.id).sort(),
    m: members.map((m) => [m.id, hex(m.display_name_enc)]).sort(),
  })
  return (await hmacHex(env.PAN_PEPPER, `snapshot:${doc}`)).slice(0, 32)
}

// ─── Consumer ───────────────────────────────────────────────────────────────────────────────────────────────────

export type RebuildOutcome = { outcome: string; requeue?: { msg: RebuildMessage; delay: number } }

/** pf-rebuild consumer (max_batch_size 1). A wait for a slot or a retry sends a fresh, delayed message. */
export async function handleRebuildBatch(batch: MessageBatch<RebuildMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const body = msg.body
    if (!isUuid(body?.household_id)) {
      msg.ack()
      continue
    }
    try {
      const next = await runRebuild(env, body)
      if (next.requeue) await rebuildQueue.send(env, next.requeue.msg, next.requeue.delay)
      msg.ack()
    } catch (err) {
      console.error('rebuild_error', (err as Error).name)
      msg.retry({ delaySeconds: 30 })
    }
  }
}

/** One delivery of a rebuild message. */
export async function runRebuild(env: Env, msg: RebuildMessage, now = Date.now()): Promise<RebuildOutcome> {
  const db = env.DB
  const hid = msg.household_id
  const started = Date.now()

  // 1. Inputs and their hash.
  const [hRes, sRes, mRes, snapRes] = await db.batch([
    db.prepare('SELECT dek_wrapped, kek_version, owner_user_id FROM household WHERE id = ?1').bind(hid),
    db.prepare('SELECT id, member_id, kind, as_of, created_at, blob_key FROM statement WHERE household_id = ?1').bind(hid),
    db.prepare('SELECT id, display_name_enc FROM member WHERE household_id = ?1').bind(hid),
    db.prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshot WHERE household_id = ?1`).bind(hid),
  ])
  const household = hRes!.results[0] as { dek_wrapped: number[]; kek_version: number; owner_user_id: string } | undefined
  const snap = snapRes!.results[0] as SnapshotRow | undefined
  if (!household || !snap) return done(env, msg, 'gone')
  const loadedAt = now
  // Fresh, not the 5-minute edge copy: right after a day turns final, prebuild messages must see the new nav_key.
  const market = marketInputs(await marketStatus(env), now)
  const used = usedStatements(sRes!.results as StatementRow[])
  const members = mRes!.results as MemberRow[]
  const hash = await inputsHash(env, market, used, members)

  if (!used.length) return clearSnapshot(env, msg, snap, hash, market, loadedAt)

  if (!msg.force && snap.inputs_hash === hash && snap.blob_key) {
    await db.prepare('UPDATE snapshot SET checked_at = MAX(COALESCE(checked_at, 0), ?1) WHERE household_id = ?2 AND inputs_hash = ?3').bind(loadedAt, hid, hash).run()
    return done(env, msg, 'current')
  }

  // 2. A slot. None free: wait, keeping the place in the queue.
  const slot = await engineApi.acquire(env, { cls: 'batch', wait: true, ticket: msg.ticket })
  if (!slot.ok) {
    const ticket = slot.code === 'busy' ? slot.ticket : undefined
    return { outcome: 'waiting', requeue: { msg: { ...msg, ticket }, delay: waitDelay(slot.code === 'busy' ? slot.eta_s : 30) } }
  }

  // 3. Claim. Zero rows: another consumer is building exactly these inputs.
  const claim = await db
    .prepare(
      `UPDATE snapshot SET status = 'building', building_hash = ?1, building_until = ?2
       WHERE household_id = ?3 AND (building_hash IS NULL OR building_until < ?4 OR building_hash <> ?1)`,
    )
    .bind(hash, now + CLAIM_MS, hid, now)
    .run()
  if (!(claim.meta.changes ?? 0)) {
    await engineApi.release(env, slot)
    return done(env, msg, 'taken')
  }

  let newKey: string | null = null
  let holding = true
  try {
    // 4. Decrypt, build, seal.
    const t = new Tenant(env, hid, household.owner_user_id)
    const vault = await t.vaultFromRow(household)
    const request = await buildRequest(env, vault, used, members, market, now)
    holding = false
    const built = await engineApi.build(env, slot, request.body)
    if (!built.ok) throw new BuildError(built.code)
    newKey = blobKeys.snapshot(hid, `${hash}-${crypto.randomUUID().slice(0, 8)}`)
    await env.BUCKET.put(newKey, await vault.seal(newKey, built.gzip, FLAG_GZIP), { httpMetadata: { contentType: 'application/octet-stream' } })

    // 5. Compare-and-set the pointer; read the previous blob and any newer request in the same transaction.
    const [prevRes, cas] = await db.batch<{ blob_key: string | null; requested_at: number | null }>([
      db.prepare('SELECT blob_key, requested_at FROM snapshot WHERE household_id = ?1').bind(hid),
      db
        .prepare(
          `UPDATE snapshot SET blob_key = ?1, inputs_hash = ?2, market_date = ?3, status = 'ready', building_hash = NULL,
             building_until = NULL, built_at = ?4, checked_at = ?5, failed_at = NULL
           WHERE household_id = ?6 AND building_hash = ?2`,
        )
        .bind(newKey, hash, market.marketDate, Date.now(), loadedAt, hid),
    ])
    if (!(cas!.meta.changes ?? 0)) {
      // A newer build claimed the household meanwhile: ours never becomes visible.
      await deleteBlobs(env, hid, [newKey])
      return done(env, msg, 'superseded')
    }
    const prev = prevRes!.results[0]
    // 6. The previous blob goes (M12 also drops its daily/ cache entries here).
    if (prev?.blob_key && prev.blob_key !== newKey) {
      await deleteBlobs(env, hid, [prev.blob_key]).catch((e) => console.error('blob_delete_failed', (e as Error).name, 1))
    }
    console.log('rebuild_ok', {
      statements: used.length,
      members: members.length,
      bytes: built.gzip.length,
      rss_mb: built.peakRssMb,
      nav_hits: built.navHits,
      nav_misses: built.navMisses,
      backfilling: request.refresh.length,
      ms: Date.now() - started,
    })
    if ((prev?.requested_at ?? 0) > loadedAt) await rebuildQueue.send(env, { household_id: hid })
    const followups = msg.followups ?? 0
    if (request.refresh.length && followups < MAX_FOLLOWUPS) {
      return { outcome: 'built', requeue: { msg: { household_id: hid, force: true, followups: followups + 1 }, delay: FOLLOWUP_DELAY_S } }
    }
    return { outcome: 'built' }
  } catch (err) {
    if (holding) await engineApi.release(env, slot).catch(() => undefined)
    if (newKey) await deleteBlobs(env, hid, [newKey]).catch(() => undefined)
    await db
      .prepare(`UPDATE snapshot SET status = 'failed', building_hash = NULL, building_until = NULL, failed_at = ?1 WHERE household_id = ?2 AND building_hash = ?3`)
      .bind(Date.now(), hid, hash)
      .run()
    const code = err instanceof BuildError ? err.code : (err as Error).name
    const attempts = (msg.attempts ?? 0) + 1
    console.error('rebuild_failed', { code, attempts })
    if (attempts < MAX_BUILD_ATTEMPTS) return { outcome: 'retry', requeue: { msg: { household_id: hid, force: msg.force, followups: msg.followups, attempts }, delay: 30 * attempts } }
    return { outcome: 'failed' }
  }
}

class BuildError extends Error {
  override name = 'BuildError'
  constructor(readonly code: string) {
    super(code)
  }
}

async function done(env: Env, msg: RebuildMessage, outcome: string): Promise<RebuildOutcome> {
  // A message that waited for a slot holds a ticket; it won't ask again.
  if (msg.ticket !== undefined) await env.ENGINE_POOL.getByName('pool').forget('batch', msg.ticket).catch(() => undefined)
  return { outcome }
}

/** No statements left: the snapshot becomes empty (onboarding) and its blob goes. */
async function clearSnapshot(env: Env, msg: RebuildMessage, snap: SnapshotRow, hash: string, market: MarketInputs, loadedAt: number): Promise<RebuildOutcome> {
  const db = env.DB
  const hid = msg.household_id
  if (!snap.blob_key && snap.inputs_hash === hash) {
    await db.prepare('UPDATE snapshot SET checked_at = MAX(COALESCE(checked_at, 0), ?1) WHERE household_id = ?2').bind(loadedAt, hid).run()
    return done(env, msg, 'current')
  }
  const [prevRes, upd] = await db.batch<{ blob_key: string | null }>([
    db.prepare('SELECT blob_key FROM snapshot WHERE household_id = ?1').bind(hid),
    db
      .prepare(
        `UPDATE snapshot SET blob_key = NULL, inputs_hash = ?1, market_date = ?2, status = 'ready', building_hash = NULL,
           building_until = NULL, built_at = ?3, checked_at = ?3, failed_at = NULL
         WHERE household_id = ?4 AND (building_hash IS NULL OR building_until < ?3)`,
      )
      .bind(hash, market.marketDate, loadedAt, hid),
  ])
  if (!(upd!.meta.changes ?? 0)) return done(env, msg, 'taken') // a build is running; its recheck asks again
  const prev = prevRes!.results[0]?.blob_key
  if (prev) await deleteBlobs(env, hid, [prev]).catch((e) => console.error('blob_delete_failed', (e as Error).name, 1))
  return done(env, msg, 'emptied')
}

type BuildItem = { member_id: string; name: string | null; data: Record<string, unknown> }

/**
 * The /build body: the decrypted statements (with each member's name, or null when it's still the holder name the
 * engine would use), the market day, ISIN → AMFI codes for funds the statements don't code (CDSL), and the codes
 * whose NAV history is still being backfilled (`refresh`: the engine reads them fresh, and we build again later).
 */
async function buildRequest(env: Env, vault: Vault, used: StatementRow[], members: MemberRow[], market: MarketInputs, now: number) {
  const names = new Map<string, string | null>()
  for (const m of members) names.set(m.id, m.display_name_enc ? await vault.openText(fieldKey.name(m.id), m.display_name_enc) : null)
  const items: BuildItem[] = []
  const isins = new Set<string>()
  const holderNames = new Map<string, Set<string>>()
  for (const s of used) {
    const blob = await getJsonBlob<{ statement: Record<string, unknown> }>(env, vault, s.blob_key)
    if (!blob?.statement) throw new BuildError('statement_missing')
    const st = blob.statement
    for (const h of Array.isArray(st.holdings) ? (st.holdings as Array<{ isin?: unknown }>) : []) {
      if (typeof h.isin === 'string') isins.add(h.isin.toUpperCase())
    }
    const holder = cleanName(st.holder_name)
    if (holder) holderNames.set(s.member_id, (holderNames.get(s.member_id) ?? new Set()).add(holder))
    items.push({ member_id: s.member_id, name: null, data: st })
  }
  // A renamed member keeps the new name; an unrenamed one gets the engine's title-cased holder name.
  for (const item of items) {
    const name = names.get(item.member_id) ?? null
    item.name = name && !holderNames.get(item.member_id)?.has(name) ? name : null
  }

  const res = await env.MARKET.withSession('first-unconstrained')
    .prepare(
      `SELECT t.isin, t.amfi_code, b.status FROM tracked_scheme t LEFT JOIN nav_backfill b ON b.amfi_code = t.amfi_code
       WHERE t.isin IN (SELECT value FROM json_each(?1))
       UNION ALL SELECT NULL, amfi_code, status FROM nav_backfill WHERE amfi_code = ?2`,
    )
    .bind(JSON.stringify([...isins]), Number(BENCHMARK_CODE))
    .all<{ isin: string | null; amfi_code: number | null; status: string | null }>()
  const isinToCode: Record<string, string> = {}
  const refresh = new Set<string>()
  for (const r of res.results) {
    if (r.amfi_code === null) continue
    if (r.isin) isinToCode[r.isin] = String(r.amfi_code)
    if (r.status === 'pending') refresh.add(String(r.amfi_code))
  }
  const body = JSON.stringify({
    statements: items,
    market: { market_date: market.marketDate, nav_key: market.navKey, isin_to_code: isinToCode, refresh: [...refresh], stocks: null },
    today: ymdToIso(istToday(now)),
    format: 'gzip',
  })
  return { body, refresh: [...refresh] }
}

// ─── snapshot-prebuild (§10.3) ──────────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild recently active households once the latest market day is final (or at the 05:00 UTC fallback). Runs once
 * per market date. Messages are spread over 30 minutes; pf-rebuild's concurrency and the EngineBatch cap set the pace.
 */
export async function prebuild(env: Env, opts: { now?: number; finalDates?: string[] } = {}): Promise<{ households: number; skipped?: string }> {
  const now = opts.now ?? Date.now()
  const status = await marketStatus(env)
  const day = status.latest_nav_date
  if (!day) return { households: 0, skipped: 'no_market_day' }
  // A weekend or holiday date turning final (only the daily-NAV funds) isn't worth rebuilding everyone for.
  if (opts.finalDates && !opts.finalDates.includes(day)) return { households: 0, skipped: 'not_latest' }
  const claim = await env.DB.prepare('INSERT INTO prebuild_run (market_date, at) VALUES (?1, ?2) ON CONFLICT DO NOTHING').bind(day, now).run()
  if (!(claim.meta.changes ?? 0)) return { households: 0, skipped: 'done' }

  let households = 0
  let cursor = ''
  for (;;) {
    const page = await env.DB.prepare(
      `SELECT h.id FROM household h JOIN snapshot s ON s.household_id = h.id
       WHERE h.last_active_at > ?1 AND h.id > ?2 AND EXISTS (SELECT 1 FROM statement st WHERE st.household_id = h.id)
       ORDER BY h.id LIMIT ?3`,
    )
      .bind(now - PREBUILD_ACTIVE_MS, cursor, PREBUILD_PAGE)
      .all<{ id: string }>()
    const ids = page.results.map((r) => r.id)
    if (!ids.length) break
    await env.DB.prepare('UPDATE snapshot SET requested_at = ?1 WHERE household_id IN (SELECT value FROM json_each(?2))').bind(now, JSON.stringify(ids)).run()
    await rebuildQueue.sendBatch(env, ids.map((id) => ({ body: { household_id: id }, delaySeconds: Math.floor(Math.random() * PREBUILD_SPREAD_S) })))
    households += ids.length
    cursor = ids.at(-1)!
    if (ids.length < PREBUILD_PAGE) break
  }
  await env.DB.prepare('UPDATE prebuild_run SET households = ?1 WHERE market_date = ?2').bind(households, day).run()
  console.log('snapshot_prebuild', { households })
  return { households }
}

// ─── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type SnapshotState = {
  statements: number
  blob_key: string | null
  market_date: string | null
  /** A build is running now. */
  building: boolean
  /** A rebuild was asked for and hasn't run yet. */
  pending: boolean
  /** Built on an older market day than the latest. */
  stale: boolean
  failed: boolean
  built_at: number | null
}

type StateRow = SnapshotRow & { statements: number; dek_wrapped: number[]; kek_version: number }

/** The snapshot row, the household key and the statement count: one D1 query. */
export async function readSnapshotRow(env: { DB: D1Database }, householdId: string): Promise<StateRow | null> {
  return env.DB.prepare(
    `SELECT s.${SNAPSHOT_COLUMNS.split(', ').join(', s.')}, h.dek_wrapped, h.kek_version,
            (SELECT COUNT(*) FROM statement st WHERE st.household_id = ?1) AS statements
     FROM snapshot s JOIN household h ON h.id = s.household_id WHERE s.household_id = ?1`,
  )
    .bind(householdId)
    .first<StateRow>()
}

export function snapshotState(row: StateRow, market: MarketStatus, now = Date.now()): SnapshotState {
  const building = row.status === 'building' && (row.building_until ?? 0) > now
  const pending = row.statements > 0 && (row.requested_at ?? 0) > (row.checked_at ?? 0)
  const latest = market.latest_nav_date
  const stale = !!row.blob_key && !!latest && !!row.market_date && row.market_date < latest
  return {
    statements: row.statements,
    blob_key: row.blob_key,
    market_date: row.market_date,
    building,
    pending,
    stale,
    failed: row.status === 'failed',
    built_at: row.built_at,
  }
}

/**
 * Stale-read trigger: a household with statements whose snapshot is missing or on an older market day asks for a
 * rebuild, unless one is running, was asked for recently and not handled yet, or just failed.
 */
export async function lazyRebuild(env: { DB: D1Database; Q_REBUILD: Queue }, householdId: string, row: StateRow, state: SnapshotState, now = Date.now()): Promise<boolean> {
  if (!state.statements || state.building || !(state.stale || !state.blob_key)) return false
  if (row.failed_at && now - row.failed_at < FAILED_BACKOFF_MS) return false
  const res = await env.DB.prepare(
    `UPDATE snapshot SET requested_at = ?1 WHERE household_id = ?2
       AND (requested_at IS NULL OR requested_at <= COALESCE(checked_at, 0) OR requested_at < ?3)`,
  )
    .bind(now, householdId, now - LAZY_REPEAT_MS)
    .run()
  if (!(res.meta.changes ?? 0)) return false
  await rebuildQueue.send(env, { household_id: householdId })
  return true
}
