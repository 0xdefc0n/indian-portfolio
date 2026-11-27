// GET /api/portfolio/daily (plan §10.5.3, M12): the household's daily series, cache first.
//
// 0. The cache: h/{household}/daily/{inputs_hash}_{latest_nav_date}_{member|all}.bin holds the full 366-day series
//    for that member key, sealed and gzip-compressed (D18); `days` is sliced from it. New statements change
//    inputs_hash and new NAVs change latest_nav_date, so an old entry is never read; the rebuild deletes them. While
//    coverage is partial (some funds haven't published yet), an entry is fresh for 30 minutes only.
//    The sealed blob is also kept in the data centre's edge cache (Cache API, a day): on staging an R2 read from the
//    Worker added ~250 ms to every cached call, the edge cache a few ms. It's the same sealed bytes (household key), so
//    the edge holds nothing readable, and crypto-shredding the household makes it useless too.
// 1. Otherwise: open the snapshot (units timelines, AMFI codes), read the window's NAVs and flagged NAV moves in one
//    batch on a MARKET read replica (D17), run dailySeries(), and store the result. Shares and bonds valued at
//    exchange prices (M20) add their closes to the same batch, keyed `px:{isin}`.
import type { MarketStatus } from '../routes/market'
import { blobKeys, deletePrefix, getJsonBlob, openJson, ownsKey, sealJson } from './blob'
import { ANOMALY_MOVE } from '../market/amfi'
import { EQUITY_ISIN } from '../market/prices'
import { addDaysIso, type DailyHolding, type DailyResult, dailySeries, LEAD_DAYS, type NavSeries, sliceDays } from './daily'
import type { Vault } from './crypto'

/** The cache always holds this many days; requests slice from it. */
export const DAILY_FULL_DAYS = 366
/** A partial-coverage entry is recomputed after this long, so late NAVs show up. */
export const DAILY_PARTIAL_FRESH_MS = 30 * 60_000
const CACHE_FORMAT = 2 // 2: shares and bonds included (M20)

type CacheBlob = { format: number; computed_at: number; partial: boolean; result: DailyResult }
type Snapshot = { holdings?: DailyHolding[] }

export const EMPTY_DAILY: DailyResult = {
  as_of: null,
  coverage: { updated: 0, total: 0 },
  today: null,
  series: [],
  notes: { units_as_of: null, units_exact: false, estimated: { instalments: 0, amount: 0 }, excluded: 0 },
}

const isoToYmd = (iso: string) => Number(iso.replaceAll('-', ''))
const ymdToIsoStr = (ymd: number) => `${String(ymd).slice(0, 4)}-${String(ymd).slice(4, 6)}-${String(ymd).slice(6, 8)}`

export type DailyRequest = {
  householdId: string
  vault: Vault
  snapshotKey: string
  inputsHash: string
  market: MarketStatus
  /** `all` or a member id already checked against the household (on a cache miss). */
  member: string
  days: number
  now?: number
  /** Check the member on a miss only: a hit's key could only have been written after that check. */
  checkMember?: () => Promise<unknown>
  waitUntil?: (p: Promise<unknown>) => void
}

/** `source`: where a hit came from (the edge cache or R2); a miss was computed. */
export type DailyAnswer = { result: DailyResult; cache: 'hit' | 'miss'; source: 'edge' | 'r2' | 'computed' }

/** How long the edge keeps a sealed daily blob. Its key changes with new statements and NAVs, so it's never stale. */
export const DAILY_EDGE_TTL_S = 86_400
const edgeRequest = (env: { APP_URL: string }, key: string) => new Request(new URL(`/__daily-cache/${key}`, env.APP_URL).toString())

async function edgePut(env: { APP_URL: string }, key: string, sealed: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  if (typeof caches === 'undefined') return
  // The Cache API skips `private` / `no-store` responses. This entry is never served to a browser (the route builds
  // its own response) and holds sealed bytes only, so a plain max-age is right.
  const res = new Response(sealed, { headers: { 'content-type': 'application/octet-stream', 'cache-control': `max-age=${DAILY_EDGE_TTL_S}` } })
  await caches.default.put(edgeRequest(env, key), res).catch(() => undefined)
}

/** The sealed blob, from the edge cache first, then R2 (and then into the edge cache). */
async function readSealed(env: Env, key: string, waitUntil?: (p: Promise<unknown>) => void): Promise<{ bytes: ArrayBuffer; from: 'edge' | 'r2' } | null> {
  const hit = typeof caches === 'undefined' ? undefined : await caches.default.match(edgeRequest(env, key)).catch(() => undefined)
  if (hit) return { bytes: await hit.arrayBuffer(), from: 'edge' }
  const obj = await env.BUCKET.get(key)
  if (!obj) return null
  const bytes = await obj.arrayBuffer()
  const put = edgePut(env, key, bytes.slice(0))
  if (waitUntil) waitUntil(put)
  else await put
  return { bytes, from: 'r2' }
}

export async function dailyFor(env: Env, req: DailyRequest): Promise<DailyAnswer> {
  const now = req.now ?? Date.now()
  const key = blobKeys.daily(req.householdId, req.inputsHash, req.market.latest_nav_date ?? 'none', req.member)
  if (!ownsKey(req.householdId, key)) throw new Error('daily key outside the household')
  const sealed = await readSealed(env, key, req.waitUntil).catch(() => null)
  const cached = sealed ? await openJson<CacheBlob>(req.vault, key, sealed.bytes).catch(() => null) : null
  if (sealed && cached?.format === CACHE_FORMAT && (!cached.partial || now - cached.computed_at < DAILY_PARTIAL_FRESH_MS)) {
    return { result: sliceDays(cached.result, req.days), cache: 'hit', source: sealed.from }
  }
  if (req.member !== 'all') await req.checkMember?.()

  if (!ownsKey(req.householdId, req.snapshotKey)) throw new Error('snapshot key outside the household')
  const snap = await getJsonBlob<Snapshot>(env, req.vault, req.snapshotKey)
  const holdings = (snap?.holdings ?? [])
    .filter((h) => req.member === 'all' || h.member_id === req.member)
    .map((h) => (h.price_source === 'exchange' && EQUITY_ISIN.test(h.isin) ? { ...h, series_key: priceKey(h.isin) } : h))
  const codes = [...new Set(holdings.map((h) => h.amfi_code).filter((c): c is string => !!c && /^\d{1,9}$/.test(c)))]
  const isins = [...new Set(holdings.filter((h) => h.series_key).map((h) => h.isin))]
  const latest = req.market.latest_nav_date
  const from = addDaysIso(latest ?? new Date(now).toISOString().slice(0, 10), -(DAILY_FULL_DAYS + LEAD_DAYS + 1))
  const { navs, anomalies } = codes.length || isins.length ? await readNavs(env, codes, isins, isoToYmd(from)) : { navs: new Map(), anomalies: new Set<string>() }

  const result = dailySeries({ holdings, navs, anomalies, latest, days: DAILY_FULL_DAYS })
  const blob: CacheBlob = { format: CACHE_FORMAT, computed_at: now, partial: result.coverage.updated < result.coverage.total, result }
  const bytes = await sealJson(req.vault, key, blob)
  // R2 is awaited (the next call anywhere is sure to hit); the edge copy can follow
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } }).catch((e) => console.error('daily_cache_put_failed', (e as Error).name))
  const edge = edgePut(env, key, bytes.slice(0))
  if (req.waitUntil) req.waitUntil(edge)
  else await edge
  return { result: sliceDays(result, req.days), cache: 'miss', source: 'computed' }
}

const priceKey = (isin: string) => `px:${isin}`

/**
 * One batch on a replica: the window's NAV rows for the codes (one JSON array parameter, so no bound-parameter cap),
 * the flagged NAV moves, and the exchange closes of the shares and bonds (M20). ~50 funds × 280 days ≈ 14k rows.
 */
async function readNavs(env: Env, codes: string[], isins: string[], fromYmd: number) {
  const read = env.MARKET.withSession('first-unconstrained')
  const list = JSON.stringify(codes.map(Number))
  const [navRes, anomalyRes, priceRes] = await read.batch([
    read.prepare('SELECT amfi_code, date, nav FROM nav WHERE amfi_code IN (SELECT value FROM json_each(?1)) AND date >= ?2 ORDER BY amfi_code, date').bind(list, fromYmd),
    read.prepare('SELECT amfi_code, date FROM nav_anomaly WHERE amfi_code IN (SELECT value FROM json_each(?1)) AND date >= ?2').bind(list, fromYmd),
    read.prepare('SELECT isin, date, close FROM stock_price WHERE isin IN (SELECT value FROM json_each(?1)) AND date >= ?2 ORDER BY isin, date').bind(JSON.stringify(isins), fromYmd),
  ])
  const navs = new Map<string, NavSeries>()
  for (const r of navRes!.results as { amfi_code: number; date: number; nav: number }[]) {
    const code = String(r.amfi_code)
    let s = navs.get(code)
    if (!s) navs.set(code, (s = { dates: [], navs: [] }))
    s.dates.push(ymdToIsoStr(r.date))
    s.navs.push(r.nav)
  }
  const anomalies = new Set((anomalyRes!.results as { amfi_code: number; date: number }[]).map((a) => `${a.amfi_code}|${ymdToIsoStr(a.date)}`))
  // Closes: a move beyond ±20% from the previous close is flagged like a NAV jump (a split or bonus not yet adjusted).
  let prev = null as { isin: string; close: number } | null
  for (const r of priceRes!.results as { isin: string; date: number; close: number }[]) {
    const key = priceKey(r.isin)
    let s = navs.get(key)
    if (!s) navs.set(key, (s = { dates: [], navs: [] }))
    const iso = ymdToIsoStr(r.date)
    if (prev?.isin === r.isin && Math.abs(r.close / prev.close - 1) > ANOMALY_MOVE) anomalies.add(`${key}|${iso}`)
    s.dates.push(iso)
    s.navs.push(r.close)
    prev = { isin: r.isin, close: r.close }
  }
  return { navs, anomalies }
}

/** Drop a snapshot's cached daily series (all of the household's with no hash). Never throws. */
export async function deleteDailyCache(env: { BUCKET: R2Bucket }, householdId: string, inputsHash?: string | null): Promise<number> {
  if (inputsHash === null) return 0
  try {
    return await deletePrefix(env, blobKeys.dailyPrefix(householdId, inputsHash))
  } catch (e) {
    console.error('daily_cache_delete_failed', (e as Error).name)
    return 0
  }
}
