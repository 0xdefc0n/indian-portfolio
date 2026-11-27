// Snapshot helpers (M10): the recorded pf-rebuild sends, running the consumer, a fake engine /build, and statements
// stored the way storeStatement writes them. All values are synthetic.
import { env } from 'cloudflare:test'
import { vi } from 'vitest'
import { blobKeys, gunzip, gzip, putJsonBlob } from '../../src/lib/blob'
import { engineApi, type EngineBuild, type EngineLease, releaseLease } from '../../src/lib/engine-client'
import { type RebuildMessage, runRebuild } from '../../src/lib/snapshot'
import type { StockData } from '../../src/market/stocks'
import type { Household } from './tenant'

type Recorded = { msg: RebuildMessage; delay: number }
const recorded = () => (globalThis as { pfRecordedRebuilds?: Recorded[] }).pfRecordedRebuilds!

/** pf-rebuild sends since the last call, for one household (all of them when omitted). */
export function takeRebuilds(householdId?: string): Recorded[] {
  const all = recorded()
  const mine = all.filter((r) => !householdId || r.msg.household_id === householdId)
  for (const r of mine) all.splice(all.indexOf(r), 1)
  return mine
}

/** Deliver each message (in order); follow-ups and waits they send are left recorded for the test to look at. */
export async function deliverRebuilds(msgs: Recorded[]) {
  const out = []
  for (const m of msgs) out.push(await runRebuild(env, m.msg))
  return out
}

export type BuildBody = {
  statements: { member_id: string; name: string | null; data: Record<string, unknown> }[]
  market: { market_date: string; nav_key: string; isin_to_code: Record<string, string>; refresh: string[]; stocks: StockData }
  today: string
  format: 'gzip'
}

/** What the fake engine answers: a tiny snapshot naming the statements it got, so tests can tell builds apart. */
export function fakeSnapshot(req: BuildBody) {
  const members = [...new Set(req.statements.map((s) => s.member_id))].map((id) => ({
    id,
    name: req.statements.find((s) => s.member_id === id)?.name ?? 'Holder',
    statements: req.statements.filter((s) => s.member_id === id).length,
  }))
  return { members, holdings: [], activity: [], sips: [], benchmark: null, stocks: { enabled: false }, market_date: req.market.market_date }
}

/**
 * Replace the engine's /build. `gate` (optional) is awaited before answering, so a test can hold a build open. The
 * lease from the real EnginePool is released as the real call does.
 */
export function fakeBuild(opts: { gate?: (req: BuildBody, n: number) => Promise<void>; answer?: (req: BuildBody) => EngineBuild | Promise<EngineBuild> } = {}) {
  const calls: BuildBody[] = []
  vi.spyOn(engineApi, 'build').mockImplementation(async (workerEnv: Env, lease: EngineLease, body: string) => {
    const req = JSON.parse(body) as BuildBody
    calls.push(req)
    try {
      await opts.gate?.(req, calls.length)
      const res = opts.answer ? await opts.answer(req) : await okBuild(fakeSnapshot(req))
      await releaseLease(workerEnv, lease, res.ok)
      return res
    } catch (err) {
      await releaseLease(workerEnv, lease)
      throw err
    }
  })
  return calls
}

/** `stocksWant`: the funds the fake engine says the stocks view needs (X-Engine-Stocks-Want). */
export async function okBuild(snapshot: unknown, stocksWant: [string, string][] = []): Promise<EngineBuild> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)) as Uint8Array<ArrayBuffer>
  return { ok: true, gzip: await gzip(bytes), peakRssMb: 50, navHits: 0, navMisses: 0, stocksWant }
}

export async function gunzipJson<T = unknown>(bytes: Uint8Array<ArrayBuffer>): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await gunzip(bytes))) as T
}

let n = 0
/** A statement row plus its sealed blob in storeStatement's format, with a parsed statement inside. */
export async function storedStatement(
  h: Household,
  memberId: string,
  opts: { kind?: 'CDSL' | 'CAMS' | 'KFINTECH'; asOf?: string; isins?: string[]; holder?: string; schemes?: Array<Record<string, unknown>> } = {},
) {
  const id = crypto.randomUUID()
  const key = blobKeys.statement(h.householdId, id)
  const kind = opts.kind ?? 'CDSL'
  const statement = {
    statement_type: kind === 'CDSL' ? 'CDSL_CAS' : 'RTA_CAS',
    holder_name: opts.holder ?? 'SYNTHETIC HOLDER',
    period_to: opts.asOf ?? '2026-10-31',
    holdings: (opts.isins ?? ['INF000A01011']).map((isin) => ({ isin, units: 1, value: 10 })),
    ...(opts.schemes ? { schemes: opts.schemes } : {}),
  }
  await putJsonBlob(env, await h.tenant.vault(), key, { format: 1, kind, parser_version: 'test', statement })
  await env.DB.prepare(
    `INSERT INTO statement (id, household_id, member_id, kind, as_of, blob_key, content_hash, parser_version, holdings_count, warnings_count, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'test', 1, 0, ?8)`,
  ).bind(id, h.householdId, memberId, kind, opts.asOf ?? '2026-10-31', key, `hash-${n++}-${crypto.randomUUID()}`, Date.now() + n).run()
  return { id, key }
}

/** A market day row, so marketStatus() reports `date` (YYYYMMDD) as the latest full NAV day. */
export async function setMarketDay(date: number, opts: { final?: boolean; coverage?: number } = {}) {
  const total = 100
  await env.MARKET.prepare(
    `INSERT INTO market_day (date, schemes_updated, tracked_total, tracked_updated, final) VALUES (?1, 10000, ?2, ?3, ?4)
     ON CONFLICT (date) DO UPDATE SET schemes_updated = excluded.schemes_updated, tracked_updated = excluded.tracked_updated, final = excluded.final`,
  ).bind(date, total, Math.round((opts.coverage ?? 100) * total / 100), opts.final === false ? 0 : 1).run()
  await caches.default.delete(new Request('http://localhost:8787/api/market/status'))
}

export async function snapshotRow(householdId: string) {
  return env.DB.prepare('SELECT * FROM snapshot WHERE household_id = ?1').bind(householdId).first<Record<string, unknown> & { blob_key: string | null; status: string }>()
}
